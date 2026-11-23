import { baseName, isSameOrInside, joinPath, parentPath, replacePrefix } from "../path";
import type { StorageProvider } from "../storage/provider";
import type { RemoteEntry, RemoteKind, RemoteStorage } from "../remote/remote";
import { sameBytes } from "../bytes";

export interface SyncReport {
  uploaded: number;
  downloaded: number;
  deletedLocally: number;
  deletedRemotely: number;
  movedLocally: number;
  movedRemotely: number;
  conflicts: string[];
  skipped: string[];
}

interface Snapshot {
  version: 1;
  entries: Record<string, SnapshotEntry>;
}

interface SnapshotEntry {
  kind: RemoteKind;
  local: string;
  remote: string;
}

interface Entry {
  kind: RemoteKind;
  fingerprint: string;
}

interface Move {
  from: string;
  to: string;
}

interface MovePlan {
  directories: Move[];
  files: Move[];
  coveredFiles: Set<string>;
}

interface SyncPlan {
  files: Map<string, FileAction>;
  directories: Map<string, DirectoryAction>;
  remoteMoves: MovePlan;
  localMoves: MovePlan;
  skipped: string[];
}

type FileAction = "keep" | "upload" | "download" | "conflict" | "reconcile" | "deleteLocal" | "deleteRemote";
type DirectoryAction = "keep" | "createLocal" | "createRemote" | "deleteLocal" | "deleteRemote";
type Base = Record<string, SnapshotEntry>;

const SYNC_DIRECTORY = ".sync";
const SNAPSHOT_PATH = `${SYNC_DIRECTORY}/state.json`;
const TEMPORARY_FILE = /^\..*\.tmp$/;
const PARALLEL_TRANSFERS = 4;

export function isSyncMetadata(path: string): boolean {
  return isSameOrInside(path, SYNC_DIRECTORY) || TEMPORARY_FILE.test(baseName(path));
}

export class SyncEngine {
  readonly #local: StorageProvider;
  readonly #remote: RemoteStorage;
  readonly #now: () => Date;

  constructor(local: StorageProvider, remote: RemoteStorage, now: () => Date = () => new Date()) {
    this.#local = local;
    this.#remote = remote;
    this.#now = now;
  }

  async run(): Promise<SyncReport> {
    const [local, remote, base] = await Promise.all([this.#scanLocal(), this.#scanRemote(), this.#readSnapshot()]);
    const plan = planSync(local, remote, base);
    const next: Base = {};
    const report: SyncReport = {
      uploaded: 0,
      downloaded: 0,
      deletedLocally: 0,
      deletedRemotely: 0,
      movedLocally: 0,
      movedRemotely: 0,
      conflicts: [],
      skipped: plan.skipped,
    };

    const moveTargets = [...plan.remoteMoves.directories, ...plan.localMoves.directories].map((move) => move.to);
    const insideMoveTarget = (path: string) => moveTargets.some((target) => path !== target && isSameOrInside(path, target));
    const directories = sortByDepth(plan.directories, "ascending");

    await this.#applyDirectories(directories.filter(([path]) => !insideMoveTarget(path)), next);

    for (const move of plan.remoteMoves.directories) await this.#remote.move(move.from, move.to);
    for (const move of plan.localMoves.directories) await this.#local.move(move.from, move.to);

    await this.#applyDirectories(directories.filter(([path]) => insideMoveTarget(path)), next);

    await runLimited(plan.remoteMoves.files, async ({ from, to }) => {
      if (!plan.remoteMoves.coveredFiles.has(to)) await this.#remote.move(from, to);
      next[to] = fileEntry(local.get(to)!.fingerprint, base[from].remote);
      report.movedRemotely += 1;
    });

    await runLimited(plan.localMoves.files, async ({ from, to }) => {
      if (!plan.localMoves.coveredFiles.has(to)) await this.#local.move(from, to);
      next[to] = fileEntry(await this.#localFingerprint(to), remote.get(to)!.fingerprint);
      report.movedLocally += 1;
    });

    const actions = [...plan.files];
    const isDeletion = ([, action]: [string, FileAction]) => action.startsWith("delete");

    await runLimited(
      actions.filter((action) => !isDeletion(action)),
      ([path, action]) => this.#transfer(path, action, local, remote, next, report),
    );
    await runLimited(actions.filter(isDeletion), ([path, action]) => this.#delete(path, action, report));

    for (const [path, action] of sortByDepth(plan.directories, "descending")) {
      if (action === "deleteLocal") await this.#local.remove(path);
      if (action === "deleteRemote") await this.#remote.remove(path);
    }

    await this.#writeSnapshot(next);
    return report;
  }

  async #applyDirectories(directories: [string, DirectoryAction][], next: Base): Promise<void> {
    for (const [path, action] of directories) {
      if (action === "createRemote") await this.#remote.createDirectory(path);
      if (action === "createLocal") await this.#local.createDirectory(path);
      if (!action.startsWith("delete")) next[path] = { kind: "directory", local: "", remote: "" };
    }
  }

  async #transfer(
    path: string,
    action: FileAction,
    local: Map<string, Entry>,
    remote: Map<string, Entry>,
    next: Base,
    report: SyncReport,
  ): Promise<void> {
    switch (action) {
      case "keep":
        next[path] = fileEntry(local.get(path)!.fingerprint, remote.get(path)!.fingerprint);
        break;
      case "upload":
        next[path] = fileEntry(local.get(path)!.fingerprint, await this.#upload(path));
        report.uploaded += 1;
        break;
      case "download":
        next[path] = fileEntry(await this.#writeLocal(path, await this.#remote.download(path)), remote.get(path)!.fingerprint);
        report.downloaded += 1;
        break;
      case "reconcile":
      case "conflict":
        await this.#resolveConflict(path, remote.get(path)!, action === "reconcile", next, report);
        break;
    }
  }

  async #delete(path: string, action: FileAction, report: SyncReport): Promise<void> {
    if (action === "deleteLocal") {
      await this.#local.remove(path);
      report.deletedLocally += 1;
    } else {
      await this.#remote.remove(path);
      report.deletedRemotely += 1;
    }
  }

  async #resolveConflict(
    path: string,
    remoteEntry: Entry,
    identicalAllowed: boolean,
    next: Base,
    report: SyncReport,
  ): Promise<void> {
    const [localData, remoteData] = await Promise.all([this.#local.readBinary(path), this.#remote.download(path)]);

    if (identicalAllowed && sameBytes(localData, remoteData)) {
      next[path] = fileEntry(await this.#localFingerprint(path), remoteEntry.fingerprint);
      return;
    }

    const copyPath = conflictPath(path, this.#now());
    await this.#local.writeBinary(copyPath, localData);
    next[path] = fileEntry(await this.#writeLocal(path, remoteData), remoteEntry.fingerprint);
    next[copyPath] = fileEntry(await this.#localFingerprint(copyPath), await this.#remote.upload(copyPath, localData));
    report.downloaded += 1;
    report.uploaded += 1;
    report.conflicts.push(copyPath);
  }

  async #upload(path: string): Promise<string> {
    return this.#remote.upload(path, await this.#local.readBinary(path));
  }

  async #writeLocal(path: string, data: Uint8Array<ArrayBuffer>): Promise<string> {
    await this.#local.writeBinary(path, data);
    return this.#localFingerprint(path);
  }

  async #localFingerprint(path: string): Promise<string> {
    const { size, modified } = await this.#local.stat(path);
    return `${size}:${modified}`;
  }

  async #scanLocal(): Promise<Map<string, Entry>> {
    const entries = new Map<string, Entry>();
    const pending = [""];

    while (pending.length > 0) {
      const directory = pending.pop()!;

      for (const child of await this.#local.list(directory)) {
        const path = joinPath(directory, child.name);
        if (isSyncMetadata(path)) continue;

        if (child.kind === "directory") {
          entries.set(path, { kind: "directory", fingerprint: "" });
          pending.push(path);
        } else {
          entries.set(path, { kind: "file", fingerprint: await this.#localFingerprint(path) });
        }
      }
    }

    return entries;
  }

  async #scanRemote(): Promise<Map<string, Entry>> {
    const entries = new Map<string, Entry>();

    for (const entry of await this.#remote.listAll()) {
      if (!isSyncMetadata(entry.path)) entries.set(entry.path, toEntry(entry));
    }

    return entries;
  }

  async #readSnapshot(): Promise<Base> {
    try {
      const snapshot: Snapshot = JSON.parse(await this.#local.readText(SNAPSHOT_PATH));
      return snapshot.version === 1 ? snapshot.entries : {};
    } catch {
      return {};
    }
  }

  async #writeSnapshot(entries: Base): Promise<void> {
    const snapshot: Snapshot = { version: 1, entries };
    await this.#local.createDirectory(SYNC_DIRECTORY);
    await this.#local.writeText(SNAPSHOT_PATH, JSON.stringify(snapshot));
  }
}

function planSync(local: Map<string, Entry>, remote: Map<string, Entry>, base: Base): SyncPlan {
  const files = new Map<string, FileAction>();
  const directoryPaths: string[] = [];
  const skipped: string[] = [];

  for (const path of new Set([...local.keys(), ...remote.keys(), ...Object.keys(base)])) {
    const kinds = new Set([local.get(path)?.kind, remote.get(path)?.kind, base[path]?.kind].filter(Boolean));

    if (kinds.size > 1) {
      skipped.push(path);
    } else if (kinds.has("directory")) {
      directoryPaths.push(path);
    } else {
      const action = planFile(local.get(path), remote.get(path), base[path]);
      if (action) files.set(path, action);
    }
  }

  const isNew = (path: string) => !(path in base);
  const remoteFileMoves = pairMoves(
    files,
    { action: "upload", fingerprint: (path) => (isNew(path) && !remote.has(path) ? local.get(path)!.fingerprint : null) },
    { action: "deleteRemote", fingerprint: (path) => base[path].local },
  );
  const localFileMoves = pairMoves(
    files,
    { action: "download", fingerprint: (path) => (isNew(path) && !local.has(path) ? remote.get(path)!.fingerprint : null) },
    { action: "deleteLocal", fingerprint: (path) => base[path].remote },
  );

  const keptFiles = [
    ...[...files].filter(([, action]) => !action.startsWith("delete")).map(([path]) => path),
    ...[...remoteFileMoves, ...localFileMoves].map((move) => move.to),
  ];
  const directories = planDirectories(directoryPaths, local, remote, base, keptFiles);

  return {
    files,
    directories,
    remoteMoves: collapseDirectoryMoves(remoteFileMoves, directories, "deleteRemote", "createRemote", base),
    localMoves: collapseDirectoryMoves(localFileMoves, directories, "deleteLocal", "createLocal", base),
    skipped,
  };
}

function planFile(local: Entry | undefined, remote: Entry | undefined, base: SnapshotEntry | undefined): FileAction | null {
  const localChanged = local !== undefined && local.fingerprint !== base?.local;
  const remoteChanged = remote !== undefined && remote.fingerprint !== base?.remote;

  if (local && remote) {
    if (!base) return "reconcile";
    if (localChanged && remoteChanged) return "conflict";
    if (localChanged) return "upload";
    if (remoteChanged) return "download";
    return "keep";
  }

  if (local) return base && !localChanged ? "deleteLocal" : "upload";
  if (remote) return base && !remoteChanged ? "deleteRemote" : "download";
  return null;
}

interface MoveSide {
  action: FileAction;
  fingerprint: (path: string) => string | null;
}

function pairMoves(files: Map<string, FileAction>, arrived: MoveSide, departed: MoveSide): Move[] {
  const group = (side: MoveSide) => {
    const groups = new Map<string, string[]>();

    for (const [path, action] of files) {
      const fingerprint = action === side.action ? side.fingerprint(path) : null;
      if (fingerprint) groups.set(fingerprint, [...(groups.get(fingerprint) ?? []), path]);
    }

    return groups;
  };

  const departures = group(departed);
  const moves: Move[] = [];

  for (const [fingerprint, targets] of group(arrived)) {
    const sources = departures.get(fingerprint);

    if (targets.length === 1 && sources?.length === 1) {
      moves.push({ from: sources[0], to: targets[0] });
      files.delete(sources[0]);
      files.delete(targets[0]);
    }
  }

  return moves;
}

function collapseDirectoryMoves(
  fileMoves: Move[],
  directories: Map<string, DirectoryAction>,
  departed: DirectoryAction,
  arrived: DirectoryAction,
  base: Base,
): MovePlan {
  const plan: MovePlan = { directories: [], files: fileMoves, coveredFiles: new Set() };
  const destinations = new Map(fileMoves.map((move) => [move.from, move.to]));
  const candidates = (action: DirectoryAction) =>
    [...directories].filter(([, candidate]) => candidate === action).map(([path]) => path);

  for (const from of candidates(departed).sort((a, b) => depth(a) - depth(b))) {
    if (plan.directories.some((move) => isSameOrInside(from, move.from))) continue;

    const baseFiles = Object.keys(base).filter(
      (path) => base[path].kind === "file" && path !== from && isSameOrInside(path, from),
    );
    if (baseFiles.length === 0) continue;

    const to = candidates(arrived).find(
      (candidate) =>
        !plan.directories.some((move) => isSameOrInside(candidate, move.to)) &&
        baseFiles.every((path) => destinations.get(path) === replacePrefix(path, from, candidate)),
    );
    if (!to) continue;

    plan.directories.push({ from, to });
    for (const path of baseFiles) plan.coveredFiles.add(destinations.get(path)!);

    for (const path of [...directories.keys()]) {
      if (isSameOrInside(path, from)) directories.delete(path);
    }

    for (const path of Object.keys(base)) {
      if (base[path].kind === "directory" && isSameOrInside(path, from)) {
        const moved = replacePrefix(path, from, to);
        if (directories.get(moved) === arrived) directories.set(moved, "keep");
      }
    }

    directories.set(to, "keep");
  }

  return plan;
}

function planDirectories(
  paths: string[],
  local: Map<string, Entry>,
  remote: Map<string, Entry>,
  base: Base,
  keptFiles: string[],
): Map<string, DirectoryAction> {
  const actions = new Map<string, DirectoryAction>();
  const isKept = (path: string) => {
    const action = actions.get(path);
    return action !== undefined && !action.startsWith("delete");
  };
  const hasKeptChild = (path: string) =>
    keptFiles.some((file) => isSameOrInside(file, path)) ||
    [...actions.keys()].some((child) => child !== path && isSameOrInside(child, path) && isKept(child));

  for (const path of [...paths].sort((a, b) => depth(b) - depth(a))) {
    const inLocal = local.has(path);
    const inRemote = remote.has(path);
    const inBase = path in base;

    if (inLocal && inRemote) {
      actions.set(path, "keep");
    } else if (inLocal) {
      actions.set(path, !inBase || hasKeptChild(path) ? "createRemote" : "deleteLocal");
    } else if (inRemote) {
      actions.set(path, !inBase || hasKeptChild(path) ? "createLocal" : "deleteRemote");
    }
  }

  return actions;
}

async function runLimited<T>(items: T[], task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failure: { error: unknown } | null = null;

  const worker = async () => {
    while (failure === null && next < items.length) {
      const item = items[next++];

      try {
        await task(item);
      } catch (error) {
        failure ??= { error };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(PARALLEL_TRANSFERS, items.length) }, worker));

  if (failure !== null) {
    throw (failure as { error: unknown }).error;
  }
}

function sortByDepth<T>(actions: Map<string, T>, order: "ascending" | "descending"): [string, T][] {
  const direction = order === "ascending" ? 1 : -1;
  return [...actions].sort(([a], [b]) => direction * (depth(a) - depth(b)));
}

function depth(path: string): number {
  return path.split("/").length;
}

function fileEntry(local: string, remote: string): SnapshotEntry {
  return { kind: "file", local, remote };
}

function toEntry({ kind, fingerprint }: RemoteEntry): Entry {
  return { kind, fingerprint };
}

function conflictPath(path: string, date: Date): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  const stamp = date.toISOString().slice(0, 16).replace("T", " ").replace(":", "h");
  return joinPath(parentPath(path), `${stem} (conflit ${stamp})${extension}`);
}
