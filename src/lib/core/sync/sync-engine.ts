import { baseName, isSameOrInside, joinPath, parentPath } from "../path";
import type { StorageProvider } from "../storage/provider";
import type { RemoteEntry, RemoteKind, RemoteStorage } from "../remote/remote";

export interface SyncReport {
  uploaded: number;
  downloaded: number;
  deletedLocally: number;
  deletedRemotely: number;
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

type FileAction = "keep" | "upload" | "download" | "conflict" | "reconcile" | "deleteLocal" | "deleteRemote";
type DirectoryAction = "keep" | "createLocal" | "createRemote" | "deleteLocal" | "deleteRemote";

const SYNC_DIRECTORY = ".sync";
const SNAPSHOT_PATH = `${SYNC_DIRECTORY}/state.json`;
const TEMPORARY_FILE = /^\..*\.tmp$/;

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
    const report: SyncReport = {
      uploaded: 0,
      downloaded: 0,
      deletedLocally: 0,
      deletedRemotely: 0,
      conflicts: [],
      skipped: [],
    };

    const [local, remote, base] = await Promise.all([this.#scanLocal(), this.#scanRemote(), this.#readSnapshot()]);
    const next: Record<string, SnapshotEntry> = {};
    const paths = [...new Set([...local.keys(), ...remote.keys(), ...Object.keys(base)])];

    const fileActions = new Map<string, FileAction>();
    const directoryPaths: string[] = [];

    for (const path of paths) {
      const kinds = new Set([local.get(path)?.kind, remote.get(path)?.kind, base[path]?.kind].filter(Boolean));

      if (kinds.size > 1) {
        report.skipped.push(path);
      } else if (kinds.has("directory")) {
        directoryPaths.push(path);
      } else {
        const action = planFile(local.get(path), remote.get(path), base[path]);
        if (action) fileActions.set(path, action);
      }
    }

    const keptFiles = [...fileActions].filter(([, action]) => !action.startsWith("delete")).map(([path]) => path);
    const directoryActions = planDirectories(directoryPaths, local, remote, base, keptFiles);

    for (const [path, action] of sortByDepth(directoryActions, "ascending")) {
      if (action === "createRemote") await this.#remote.createDirectory(path);
      if (action === "createLocal") await this.#local.createDirectory(path);
      if (!action.startsWith("delete")) next[path] = { kind: "directory", local: "", remote: "" };
    }

    for (const [path, action] of fileActions) {
      const localEntry = local.get(path);
      const remoteEntry = remote.get(path);

      switch (action) {
        case "keep":
          next[path] = fileEntry(localEntry!.fingerprint, remoteEntry!.fingerprint);
          break;
        case "upload":
          next[path] = fileEntry(localEntry!.fingerprint, await this.#upload(path));
          report.uploaded += 1;
          break;
        case "download":
          next[path] = fileEntry(await this.#writeLocal(path, await this.#remote.download(path)), remoteEntry!.fingerprint);
          report.downloaded += 1;
          break;
        case "reconcile":
        case "conflict":
          await this.#resolveConflict(path, remoteEntry!, action === "reconcile", next, report);
          break;
        case "deleteLocal":
          await this.#local.remove(path);
          report.deletedLocally += 1;
          break;
        case "deleteRemote":
          await this.#remote.remove(path);
          report.deletedRemotely += 1;
          break;
      }
    }

    for (const [path, action] of sortByDepth(directoryActions, "descending")) {
      if (action === "deleteLocal") await this.#local.remove(path);
      if (action === "deleteRemote") await this.#remote.remove(path);
    }

    await this.#writeSnapshot(next);
    return report;
  }

  async #resolveConflict(
    path: string,
    remoteEntry: Entry,
    identicalAllowed: boolean,
    next: Record<string, SnapshotEntry>,
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

  async #readSnapshot(): Promise<Record<string, SnapshotEntry>> {
    try {
      const snapshot: Snapshot = JSON.parse(await this.#local.readText(SNAPSHOT_PATH));
      return snapshot.version === 1 ? snapshot.entries : {};
    } catch {
      return {};
    }
  }

  async #writeSnapshot(entries: Record<string, SnapshotEntry>): Promise<void> {
    const snapshot: Snapshot = { version: 1, entries };
    await this.#local.createDirectory(SYNC_DIRECTORY);
    await this.#local.writeText(SNAPSHOT_PATH, JSON.stringify(snapshot));
  }
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

function planDirectories(
  paths: string[],
  local: Map<string, Entry>,
  remote: Map<string, Entry>,
  base: Record<string, SnapshotEntry>,
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

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function conflictPath(path: string, date: Date): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  const stamp = date.toISOString().slice(0, 16).replace("T", " ").replace(":", "h");
  return joinPath(parentPath(path), `${stem} (conflit ${stamp})${extension}`);
}
