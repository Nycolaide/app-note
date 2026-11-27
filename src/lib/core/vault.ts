import {
  isNoteFile,
  normalizeTags,
  noteFileName,
  parseNote,
  serializeNote,
  titleFromPath,
  toMeta,
  type Note,
  type NoteMeta,
} from "./note";
import {
  baseName,
  isSameOrInside,
  joinPath,
  parentPath,
  replacePrefix,
  samePath,
  sanitizeName,
} from "./path";
import type { StorageProvider } from "./storage/provider";
import { attachmentReferences } from "./attachment-references";
import { sameBytes } from "./bytes";

export interface FolderNode {
  path: string;
  name: string;
  noteCount: number;
  folders: FolderNode[];
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface NoteChanges {
  content?: string;
  tags?: string[];
}

export type TrashKind = "note" | "folder";

export interface CleanupReport {
  purgedTrashEntries: number;
  removedAttachments: number;
}

export interface TrashEntry {
  id: string;
  kind: TrashKind;
  name: string;
  originalPath: string;
  deletedAt: string;
}

interface TrashMetadata {
  originalPath: string;
  deletedAt: string;
}

export type ChangeOrigin = "local" | "sync";

type Listener = (origin: ChangeOrigin) => void;

const ROOT = "";
const TRASH = ".trash";
const ATTACHMENTS = "attachments";
const TRASH_METADATA = ".entry.json";
const DEFAULT_NOTE_TITLE = "Sans titre";
const DAY_MS = 24 * 60 * 60 * 1000;
const TRASH_RETENTION_MS = 30 * DAY_MS;
const ORPHAN_ATTACHMENT_GRACE_MS = DAY_MS;


export class Vault {
  readonly #storage: StorageProvider;
  readonly #folders = new Set<string>();
  readonly #notes = new Map<string, Note>();
  readonly #trash = new Map<string, TrashEntry>();
  readonly #listeners = new Set<Listener>();
  #queue: Promise<unknown> = Promise.resolve();

  constructor(storage: StorageProvider) {
    this.#storage = storage;
  }

  onChange(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  load(): Promise<void> {
    return this.#run(() => this.#reload());
  }

  async watchExternalChanges(onExternalChange: () => void): Promise<() => void> {
    if (!this.#storage.watch) return () => undefined;

    return this.#storage.watch((paths) => {
      const relevant = paths.filter((path) => !isHiddenOrAttachment(path));
      if (relevant.length === 0) return;

      this.#run(async () => {
        if (!(await this.#differsFromDisk(relevant))) return false;
        await this.#reload();
        return true;
      }, "sync")
        .then((changed) => changed && onExternalChange())
        .catch(() => undefined);
    });
  }

  synchronize<T>(task: () => Promise<T>, needsReload: (result: T) => boolean): Promise<T> {
    return this.#run(async () => {
      const result = await task();
      if (needsReload(result)) await this.#reload();
      return result;
    }, "sync");
  }

  trash(): TrashEntry[] {
    return [...this.#trash.values()].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  }

  restoreFromTrash(id: string): Promise<string> {
    return this.#run(async () => {
      const entry = this.#requireTrashEntry(id);
      const parent = await this.#ensureFolder(parentPath(entry.originalPath));
      const target =
        entry.kind === "note"
          ? this.#availablePath(parent, entry.name, noteFileName)
          : this.#availablePath(parent, entry.name, sanitizeName);

      await this.#storage.move(this.#trashItemPath(entry), target);
      await this.#storage.remove(joinPath(TRASH, id));
      this.#trash.delete(id);

      if (entry.kind === "folder") {
        await this.#scan(target);
      } else {
        this.#notes.set(target, parseNote(target, await this.#storage.readText(target)));
      }

      return target;
    });
  }

  deleteFromTrash(id: string): Promise<void> {
    return this.#run(async () => {
      this.#requireTrashEntry(id);
      await this.#storage.remove(joinPath(TRASH, id));
      this.#trash.delete(id);
    });
  }

  cleanUp(now: Date = new Date()): Promise<CleanupReport> {
    return this.#run(async () => ({
      purgedTrashEntries: await this.#purgeExpiredTrash(now.getTime() - TRASH_RETENTION_MS),
      removedAttachments: await this.#removeOrphanAttachments(now.getTime() - ORPHAN_ATTACHMENT_GRACE_MS),
    }));
  }

  emptyTrash(): Promise<void> {
    return this.#run(async () => {
      await this.#storage.remove(TRASH);
      await this.#storage.createDirectory(TRASH);
      this.#trash.clear();
    });
  }

  tree(): FolderNode {
    const build = (path: string): FolderNode => ({
      path,
      name: baseName(path),
      noteCount: this.notesIn(path).length,
      folders: this.#childFolders(path).map(build),
    });

    return build(ROOT);
  }

  folders(): string[] {
    return [...this.#folders].sort(compareNames);
  }

  notesIn(folder: string): NoteMeta[] {
    return this.#metas((note) => parentPath(note.path) === folder);
  }

  notesWithTag(tag: string): NoteMeta[] {
    const wanted = tag.toLowerCase();
    return this.#metas((note) => note.tags.some((candidate) => candidate.toLowerCase() === wanted));
  }

  search(query: string): NoteMeta[] {
    const terms = normalizeForSearch(query).split(/\s+/).filter(Boolean);

    if (terms.length === 0) {
      return [];
    }

    return this.#metas((note) => {
      const haystack = normalizeForSearch(`${note.title}\n${note.tags.join(" ")}\n${note.content}`);
      return terms.every((term) => haystack.includes(term));
    });
  }

  tags(): TagCount[] {
    const counts = new Map<string, TagCount>();

    for (const note of this.#notes.values()) {
      for (const tag of note.tags) {
        const entry = counts.get(tag.toLowerCase()) ?? { tag, count: 0 };
        entry.count += 1;
        counts.set(tag.toLowerCase(), entry);
      }
    }

    return [...counts.values()].sort((a, b) => compareNames(a.tag, b.tag));
  }

  getNote(path: string): Note | undefined {
    return this.#notes.get(path);
  }

  isAttachment(path: string): boolean {
    const [folder, name, ...rest] = path.split("/");

    return (
      folder === ATTACHMENTS &&
      rest.length === 0 &&
      name !== undefined &&
      name.length > 0 &&
      !name.startsWith(".") &&
      !name.includes("\\")
    );
  }

  newAttachmentPath(fileName: string): string {
    return joinPath(ATTACHMENTS, `${crypto.randomUUID()}${attachmentExtension(fileName)}`);
  }

  async writeAttachment(path: string, data: Uint8Array): Promise<void> {
    if (!this.isAttachment(path)) {
      throw new Error(`Pièce jointe invalide : ${path}`);
    }

    await this.#storage.writeBinary(path, data);
  }

  async saveAttachment(data: Uint8Array, fileName: string): Promise<string> {
    const path = this.newAttachmentPath(fileName);
    await this.writeAttachment(path, data);
    return path;
  }

  async importAttachment(name: string, data: Uint8Array<ArrayBuffer>): Promise<string> {
    const path = joinPath(ATTACHMENTS, name);

    if (!this.isAttachment(path)) {
      throw new Error(`Pièce jointe invalide : ${name}`);
    }

    const existing = await this.#storage.readBinary(path).catch(() => null);

    if (existing === null) {
      await this.#storage.writeBinary(path, data);
      return path;
    }

    return sameBytes(existing, data) ? path : this.saveAttachment(data, name);
  }

  importNote(folder: string, note: Note): Promise<Note> {
    return this.#run(async () => {
      this.#assertFolder(folder);
      const path = this.#availablePath(folder, note.title, noteFileName);
      const imported: Note = { ...note, path, title: titleFromPath(path) };
      await this.#write(imported);
      return imported;
    });
  }

  readAttachment(path: string): Promise<Uint8Array<ArrayBuffer>> {
    if (!this.isAttachment(path)) {
      return Promise.reject(new Error(`Pièce jointe invalide : ${path}`));
    }

    return this.#storage.readBinary(path);
  }

  createFolder(parent: string, name: string, onConflict: "fail" | "rename" = "fail"): Promise<string> {
    return this.#run(async () => {
      this.#assertFolder(parent);
      const path =
        onConflict === "rename" ? this.#availablePath(parent, name, sanitizeName) : joinPath(parent, sanitizeName(name));
      this.#assertAvailable(path);

      await this.#storage.createDirectory(path);
      this.#folders.add(path);
      return path;
    });
  }

  renameFolder(path: string, name: string): Promise<string> {
    return this.#run(() => this.#moveFolder(path, joinPath(parentPath(path), sanitizeName(name))));
  }

  moveFolder(path: string, targetParent: string): Promise<string> {
    return this.#run(() => {
      if (isSameOrInside(targetParent, path)) {
        throw new Error("Impossible de déplacer un dossier dans lui-même.");
      }

      return this.#moveFolder(path, joinPath(targetParent, baseName(path)));
    });
  }

  trashFolder(path: string): Promise<void> {
    return this.#run(async () => {
      this.#assertNotRoot(path);
      this.#assertFolder(path);

      await this.#moveToTrash(path, "folder");

      for (const folder of [...this.#folders]) {
        if (isSameOrInside(folder, path)) this.#folders.delete(folder);
      }

      for (const notePath of [...this.#notes.keys()]) {
        if (isSameOrInside(notePath, path)) this.#notes.delete(notePath);
      }
    });
  }

  createNote(folder: string, title = DEFAULT_NOTE_TITLE): Promise<Note> {
    return this.#run(async () => {
      this.#assertFolder(folder);
      const path = this.#availablePath(folder, title, noteFileName);
      const now = new Date().toISOString();

      const note: Note = {
        id: crypto.randomUUID(),
        path,
        title: titleFromPath(path),
        tags: [],
        pinned: false,
        created: now,
        updated: now,
        content: "",
        properties: {},
      };

      await this.#write(note);
      return note;
    });
  }

  saveNote(path: string, changes: NoteChanges): Promise<Note> {
    return this.#run(async () => {
      const current = this.#requireNote(path);
      const content = changes.content ?? current.content;
      const tags = changes.tags ? normalizeTags(changes.tags) : current.tags;

      if (content === current.content && tags.join("\n") === current.tags.join("\n")) {
        return current;
      }

      const note: Note = { ...current, content, tags, updated: new Date().toISOString() };

      await this.#write(note);
      return note;
    });
  }

  setPinned(path: string, pinned: boolean): Promise<Note> {
    return this.#run(async () => {
      const current = this.#requireNote(path);
      if (current.pinned === pinned) return current;
      const note: Note = { ...current, pinned };
      await this.#write(note);
      return note;
    });
  }

  renameNote(path: string, title: string): Promise<Note> {
    return this.#run(() => this.#moveNote(path, joinPath(parentPath(path), noteFileName(title))));
  }

  moveNote(path: string, targetFolder: string): Promise<Note> {
    return this.#run(() => {
      this.#assertFolder(targetFolder);
      return this.#moveNote(path, joinPath(targetFolder, baseName(path)));
    });
  }

  trashNote(path: string): Promise<void> {
    return this.#run(async () => {
      this.#requireNote(path);
      await this.#moveToTrash(path, "note");
      this.#notes.delete(path);
    });
  }

  async #differsFromDisk(paths: string[]): Promise<boolean> {
    for (const path of paths) {
      const stat = await this.#storage.stat(path).catch(() => null);
      const note = this.#notes.get(path);

      if (isNoteFile(baseName(path))) {
        if (!stat !== !note) return true;
        if (note && (await this.#storage.readText(path).catch(() => null)) !== serializeNote(note)) return true;
      } else if (this.#folders.has(path) ? !stat : stat && (await this.#isDirectory(path))) {
        return true;
      }
    }

    return false;
  }

  async #isDirectory(path: string): Promise<boolean> {
    const entries = await this.#storage.list(parentPath(path)).catch(() => []);
    return entries.some((entry) => entry.name === baseName(path) && entry.kind === "directory");
  }

  async #reload(): Promise<void> {
    this.#folders.clear();
    this.#notes.clear();
    this.#trash.clear();
    await this.#storage.createDirectory(ROOT);
    await this.#storage.createDirectory(TRASH);
    await this.#storage.createDirectory(ATTACHMENTS);
    await this.#scan(ROOT);
    await this.#scanTrash();
  }

  async #scan(folder: string): Promise<void> {
    this.#folders.add(folder);
    const entries = await this.#storage.list(folder);

    await Promise.all(
      entries
        .filter((entry) => !entry.name.startsWith("."))
        .map(async (entry) => {
          const path = joinPath(folder, entry.name);

          if (path === ATTACHMENTS) {
            return;
          }

          if (entry.kind === "directory") {
            await this.#scan(path);
          } else if (isNoteFile(entry.name)) {
            this.#notes.set(path, parseNote(path, await this.#storage.readText(path)));
          }
        }),
    );
  }

  async #moveFolder(from: string, to: string): Promise<string> {
    this.#assertNotRoot(from);
    this.#assertFolder(from);

    if (from === to) {
      return to;
    }

    this.#assertAvailable(to, from);
    await this.#storage.move(from, to);

    for (const folder of [...this.#folders]) {
      if (isSameOrInside(folder, from)) {
        this.#folders.delete(folder);
        this.#folders.add(replacePrefix(folder, from, to));
      }
    }

    for (const note of [...this.#notes.values()]) {
      if (isSameOrInside(note.path, from)) {
        this.#notes.delete(note.path);
        const path = replacePrefix(note.path, from, to);
        this.#notes.set(path, { ...note, path });
      }
    }

    return to;
  }

  async #moveNote(from: string, to: string): Promise<Note> {
    const current = this.#requireNote(from);

    if (from === to) {
      return current;
    }

    this.#assertAvailable(to, from);
    await this.#storage.move(from, to);

    const note: Note = { ...current, path: to, title: titleFromPath(to) };
    this.#notes.delete(from);
    this.#notes.set(to, note);
    return note;
  }

  async #write(note: Note): Promise<void> {
    await this.#storage.writeText(note.path, serializeNote(note));
    this.#notes.set(note.path, note);
  }

  async #moveToTrash(path: string, kind: TrashKind): Promise<void> {
    const id = crypto.randomUUID();
    const directory = joinPath(TRASH, id);
    const metadata: TrashMetadata = { originalPath: path, deletedAt: new Date().toISOString() };

    await this.#storage.createDirectory(directory);
    await this.#storage.writeText(joinPath(directory, TRASH_METADATA), JSON.stringify(metadata));
    await this.#storage.move(path, joinPath(directory, baseName(path)));

    this.#trash.set(id, toTrashEntry(id, kind, metadata));
  }

  async #purgeExpiredTrash(deletedBefore: number): Promise<number> {
    const expired = [...this.#trash.values()].filter((entry) => {
      const deletedAt = Date.parse(entry.deletedAt);
      return !Number.isNaN(deletedAt) && deletedAt < deletedBefore;
    });

    for (const entry of expired) {
      await this.#storage.remove(joinPath(TRASH, entry.id));
      this.#trash.delete(entry.id);
    }

    return expired.length;
  }

  async #removeOrphanAttachments(modifiedBefore: number): Promise<number> {
    const contents = [...[...this.#notes.values()].map((note) => note.content), ...(await this.#trashedNoteContents())];
    const referenced = new Set(contents.flatMap((content) => [...attachmentReferences(content)]));

    let removed = 0;

    for (const entry of await this.#storage.list(ATTACHMENTS)) {
      if (entry.kind !== "file" || entry.name.startsWith(".") || referenced.has(entry.name)) continue;

      const path = joinPath(ATTACHMENTS, entry.name);
      const { modified } = await this.#storage.stat(path);

      if (modified < modifiedBefore) {
        await this.#storage.remove(path);
        removed += 1;
      }
    }

    return removed;
  }

  async #trashedNoteContents(): Promise<string[]> {
    const contents: string[] = [];
    const pending = [TRASH];

    while (pending.length > 0) {
      const directory = pending.pop()!;

      for (const child of await this.#storage.list(directory)) {
        const path = joinPath(directory, child.name);

        if (child.kind === "directory") {
          pending.push(path);
        } else if (isNoteFile(child.name)) {
          contents.push(await this.#storage.readText(path));
        }
      }
    }

    return contents;
  }

  async #scanTrash(): Promise<void> {
    const directories = (await this.#storage.list(TRASH)).filter((entry) => entry.kind === "directory");

    await Promise.all(
      directories.map(async ({ name: id }) => {
        const entry = await this.#readTrashEntry(id);
        if (entry) this.#trash.set(id, entry);
      }),
    );
  }

  async #readTrashEntry(id: string): Promise<TrashEntry | undefined> {
    const directory = joinPath(TRASH, id);
    const item = (await this.#storage.list(directory)).find((entry) => !entry.name.startsWith("."));

    if (!item || (item.kind === "file" && !isNoteFile(item.name))) {
      return undefined;
    }

    const kind: TrashKind = item.kind === "directory" ? "folder" : "note";
    const metadata = await this.#readTrashMetadata(directory);
    const matches = metadata !== undefined && baseName(metadata.originalPath) === item.name;

    return toTrashEntry(id, kind, matches ? metadata : { originalPath: item.name, deletedAt: "" });
  }

  async #readTrashMetadata(directory: string): Promise<TrashMetadata | undefined> {
    try {
      const parsed: unknown = JSON.parse(await this.#storage.readText(joinPath(directory, TRASH_METADATA)));
      return isTrashMetadata(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  #trashItemPath(entry: TrashEntry): string {
    return joinPath(TRASH, entry.id, baseName(entry.originalPath));
  }

  #requireTrashEntry(id: string): TrashEntry {
    const entry = this.#trash.get(id);

    if (!entry) {
      throw new Error(`Élément introuvable dans la corbeille : ${id}`);
    }

    return entry;
  }

  async #ensureFolder(path: string): Promise<string> {
    let current = ROOT;

    for (const segment of path.split("/").filter(Boolean)) {
      const wanted = joinPath(current, segment);
      const existing = [...this.#folders].find((folder) => samePath(folder, wanted));

      if (existing === undefined) {
        this.#assertAvailable(wanted);
        await this.#storage.createDirectory(wanted);
        this.#folders.add(wanted);
      }

      current = existing ?? wanted;
    }

    return current;
  }

  #availablePath(folder: string, name: string, toFileName: (name: string) => string): string {
    for (let index = 1; ; index += 1) {
      const candidate = index === 1 ? name : `${name} ${index}`;
      const path = joinPath(folder, toFileName(candidate));

      if (!this.#isTaken(path)) {
        return path;
      }
    }
  }

  #isTaken(path: string, ignored?: string): boolean {
    const matches = (candidate: string) =>
      samePath(candidate, path) && (ignored === undefined || !samePath(candidate, ignored));

    return (
      samePath(path, ATTACHMENTS) ||
      [...this.#folders].some(matches) ||
      [...this.#notes.keys()].some(matches)
    );
  }

  #assertAvailable(path: string, ignored?: string): void {
    if (this.#isTaken(path, ignored)) {
      throw new Error(`« ${baseName(path)} » existe déjà à cet emplacement.`);
    }
  }

  #assertFolder(path: string): void {
    if (!this.#folders.has(path)) {
      throw new Error(`Dossier introuvable : ${path || "racine"}`);
    }
  }

  #assertNotRoot(path: string): void {
    if (path === ROOT) {
      throw new Error("Le dossier racine ne peut pas être modifié.");
    }
  }

  #requireNote(path: string): Note {
    const note = this.#notes.get(path);

    if (!note) {
      throw new Error(`Note introuvable : ${path}`);
    }

    return note;
  }

  #childFolders(path: string): string[] {
    return [...this.#folders]
      .filter((folder) => folder !== ROOT && parentPath(folder) === path)
      .sort(compareNames);
  }

  #metas(predicate: (note: Note) => boolean): NoteMeta[] {
    return [...this.#notes.values()]
      .filter(predicate)
      .sort((a, b) => b.updated.localeCompare(a.updated) || compareNames(a.title, b.title))
      .map(toMeta);
  }

  #run<T>(task: () => Promise<T> | T, origin: ChangeOrigin = "local"): Promise<T> {
    const result = this.#queue.then(task);
    this.#queue = result.catch(() => undefined);
    return result.finally(() => this.#emit(origin));
  }

  #emit(origin: ChangeOrigin): void {
    for (const listener of this.#listeners) listener(origin);
  }
}

function attachmentExtension(fileName: string): string {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]{1,10})$/);
  return match ? `.${match[1]}` : "";
}

function toTrashEntry(id: string, kind: TrashKind, metadata: TrashMetadata): TrashEntry {
  const name = kind === "note" ? titleFromPath(metadata.originalPath) : baseName(metadata.originalPath);
  return { id, kind, name, ...metadata };
}

function isTrashMetadata(value: unknown): value is TrashMetadata {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.originalPath === "string" && typeof candidate.deletedAt === "string";
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function normalizeForSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function isHiddenOrAttachment(path: string): boolean {
  return path === "" || isSameOrInside(path, ATTACHMENTS) || path.split("/").some((segment) => segment.startsWith("."));
}
