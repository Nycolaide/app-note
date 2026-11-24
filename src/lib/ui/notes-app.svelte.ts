import {
  createLinkPreviewFileStore,
  createLinkPreviews,
  isSameOrInside,
  moveToVault,
  parentPath,
  SyncScheduler,
  VaultRegistry,
  type ConnectRequest,
  type GoogleDriveConnection,
  type GoogleDriveConnectRequest,
  type FolderNode,
  type LinkPreviews,
  type NoteMeta,
  type SyncStatus,
  type TagCount,
  type TrashEntry,
  type Vault,
  type VaultDescriptor,
  type VaultSession,
} from "$lib/core";
import { createAttachmentUrls, type AttachmentUrls } from "./attachment-urls";
import { cancelGoogleSignIn, googleClient, GoogleSignInCancelled, signInWithGoogle } from "./google-sign-in";

export type Pane = "list" | "note";

export type Scope = { kind: "folder"; path: string } | { kind: "tag"; tag: string } | { kind: "trash" };

export interface Destination {
  vault: VaultDescriptor;
  folder: string;
}

const SAVE_DELAY_MS = 500;
const LAST_VAULT_KEY = "runote:last-vault";

export class NotesApp {
  readonly registry = new VaultRegistry({ google: googleClient });
  readonly linkPreviews: LinkPreviews = createLinkPreviews({ store: createLinkPreviewFileStore() });

  vaults = $state.raw<VaultDescriptor[]>([]);
  session = $state.raw<VaultSession | null>(null);
  syncStatus = $state.raw<SyncStatus | null>(null);
  error = $state("");

  scope = $state.raw<Scope>({ kind: "folder", path: "" });
  query = $state("");
  selectedNotePath = $state<string | null>(null);
  pane = $state<Pane>("list");
  editorGeneration = $state(0);

  draftContent = $state("");
  draftTags = $state<string[]>([]);

  #version = $state(0);
  #attachments: AttachmentUrls | undefined;
  #scheduler: SyncScheduler | undefined;
  #unsubscribe: (() => void) | undefined;
  #stopWatching: (() => void) | undefined;
  #saveTimer: ReturnType<typeof setTimeout> | undefined;

  readonly vault = $derived(this.session?.vault ?? null);
  readonly tree = $derived(this.#track((vault): FolderNode | null => vault.tree(), null));
  readonly folders = $derived(this.#track((vault) => vault.folders(), []));
  readonly tags = $derived(this.#track((vault): TagCount[] => vault.tags(), []));
  readonly trash = $derived(this.#track((vault): TrashEntry[] => vault.trash(), []));
  readonly note = $derived(
    this.#track((vault) => (this.selectedNotePath ? vault.getNote(this.selectedNotePath) : undefined), undefined),
  );
  readonly currentFolder = $derived(this.scope.kind === "folder" ? this.scope.path : "");
  readonly searching = $derived(this.query.trim().length > 0);

  readonly notes = $derived(
    this.#track((vault): NoteMeta[] => {
      if (this.searching) return vault.search(this.query);
      if (this.scope.kind === "tag") return vault.notesWithTag(this.scope.tag);
      if (this.scope.kind === "folder") return vault.notesIn(this.scope.path);
      return [];
    }, []),
  );

  readonly listTitle = $derived.by(() => {
    if (this.searching) return "Résultats";
    if (this.scope.kind === "tag") return `#${this.scope.tag}`;
    if (this.scope.kind === "trash") return "Corbeille";
    return folderLabel(this.scope.path);
  });

  async start(): Promise<void> {
    await this.attempt(async () => {
      this.vaults = await this.registry.list();
      const lastId = readStorage(LAST_VAULT_KEY);
      await this.openVault(this.vaults.find((descriptor) => descriptor.id === lastId) ?? this.vaults[0]);
    });
  }

  stop(): void {
    this.#closeSession();
  }

  async attempt<T>(action: () => Promise<T>): Promise<T | undefined> {
    this.error = "";
    try {
      return await action();
    } catch (cause) {
      this.error = errorMessage(cause);
      return undefined;
    }
  }

  async openVault(descriptor: VaultDescriptor): Promise<void> {
    await this.flushSave();
    this.#closeSession();
    this.scope = { kind: "folder", path: "" };
    this.query = "";
    this.selectedNotePath = null;

    const opened = await this.registry.open(descriptor);
    this.session = opened;
    this.#attachments = createAttachmentUrls(opened.vault);
    this.#unsubscribe = opened.vault.onChange(() => this.#version++);
    writeStorage(LAST_VAULT_KEY, descriptor.id);
    this.attempt(() => opened.vault.cleanUp());

    opened.vault
      .watchExternalChanges(() => this.#reloadOpenNote())
      .then((stop) => (this.session === opened ? (this.#stopWatching = stop) : stop()))
      .catch(() => undefined);

    if (opened.sync) {
      this.#scheduler = new SyncScheduler({
        vault: opened.vault,
        sync: opened.sync,
        beforeSync: () => this.flushSave(),
        onStatus: (status) => (this.syncStatus = status),
        onSynced: (report) => {
          if (report.downloaded + report.deletedLocally + report.movedLocally > 0) this.#reloadOpenNote();
        },
      });
      this.#scheduler.start();
    }
  }

  syncNow(): void {
    this.#scheduler?.syncNow();
  }

  async connectVault(request: ConnectRequest): Promise<boolean> {
    const descriptor = await this.attempt(() => this.registry.connect(request));
    if (!descriptor) return false;
    this.vaults = await this.registry.list();
    await this.attempt(() => this.openVault(descriptor));
    return true;
  }

  async signInToGoogleDrive(): Promise<GoogleDriveConnection | undefined> {
    const client = googleClient;
    if (!client) return undefined;
    this.error = "";
    try {
      return await this.registry.inspectGoogleDrive(await signInWithGoogle(client));
    } catch (cause) {
      if (!(cause instanceof GoogleSignInCancelled)) this.error = errorMessage(cause);
      return undefined;
    }
  }

  cancelGoogleSignIn(): void {
    cancelGoogleSignIn().catch(() => undefined);
  }

  async connectGoogleDrive(request: GoogleDriveConnectRequest): Promise<boolean> {
    const descriptor = await this.attempt(() => this.registry.connectGoogleDrive(request));
    if (!descriptor) return false;
    this.vaults = await this.registry.list();
    await this.attempt(() => this.openVault(descriptor));
    return true;
  }

  async removeVault(descriptor: VaultDescriptor): Promise<void> {
    await this.attempt(async () => {
      if (this.session?.descriptor.id === descriptor.id) await this.openVault(this.vaults[0]);
      await this.registry.remove(descriptor.id);
      this.vaults = await this.registry.list();
    });
  }

  showFolder(path: string): void {
    this.scope = { kind: "folder", path };
    this.query = "";
    this.pane = "list";
  }

  showTag(tag: string): void {
    this.scope = { kind: "tag", tag };
    this.query = "";
    this.pane = "list";
  }

  showTrash(): void {
    this.scope = { kind: "trash" };
    this.query = "";
    this.pane = "list";
  }

  async openNote(path: string): Promise<void> {
    await this.flushSave();
    const opened = this.vault?.getNote(path);
    if (!opened) return;
    this.selectedNotePath = path;
    this.draftContent = opened.content;
    this.draftTags = opened.tags;
    this.pane = "note";
  }

  closeNote(): void {
    this.flushSave();
    this.pane = "list";
  }

  updateContent(markdown: string): void {
    this.draftContent = markdown;
    this.#scheduleSave();
  }

  async updateTags(tags: string[]): Promise<void> {
    this.draftTags = tags;
    await this.flushSave();
  }

  async flushSave(): Promise<void> {
    clearTimeout(this.#saveTimer);
    this.#saveTimer = undefined;
    const vault = this.vault;
    const note = this.note;
    if (!vault || !note) return;
    const changes = { content: this.draftContent, tags: this.draftTags };
    await this.attempt(() => vault.saveNote(note.path, changes));
  }

  async togglePinned(path: string): Promise<void> {
    const vault = this.vault;
    const note = vault?.getNote(path);
    if (!vault || !note) return;
    await this.attempt(() => vault.setPinned(path, !note.pinned));
  }

  async createNote(): Promise<void> {
    const vault = this.vault;
    if (!vault) return;
    const folder = this.currentFolder;
    const created = await this.attempt(() => vault.createNote(folder));
    if (!created) return;
    if (this.scope.kind !== "folder") this.showFolder(folder);
    await this.openNote(created.path);
  }

  async renameNote(title: string): Promise<void> {
    const vault = this.vault;
    const note = this.note;
    if (!vault || !note || title.trim() === "" || title === note.title) return;
    await this.flushSave();
    const renamed = await this.attempt(() => vault.renameNote(note.path, title));
    if (renamed) await this.openNote(renamed.path);
  }

  async trashNote(path: string): Promise<void> {
    const vault = this.vault;
    if (!vault) return;
    if (path === this.selectedNotePath) {
      clearTimeout(this.#saveTimer);
      this.selectedNotePath = null;
      this.pane = "list";
    }
    await this.attempt(() => vault.trashNote(path));
  }

  async createFolder(parent: string, name: string): Promise<boolean> {
    const vault = this.vault;
    if (!vault) return false;
    const created = await this.attempt(() => vault.createFolder(parent, name));
    if (created === undefined) return false;
    this.showFolder(created);
    return true;
  }

  async renameFolder(path: string, name: string): Promise<boolean> {
    const vault = this.vault;
    if (!vault) return false;
    await this.flushSave();
    const renamed = await this.attempt(() => vault.renameFolder(path, name));
    if (renamed === undefined) return false;
    this.#followFolder(path, renamed);
    return true;
  }

  async trashFolder(path: string): Promise<void> {
    const vault = this.vault;
    if (!vault) return;
    await this.flushSave();
    await this.attempt(async () => {
      await vault.trashFolder(path);
      this.#forgetFolder(path);
    });
  }

  async move(kind: "note" | "folder", path: string, destination: Destination): Promise<boolean> {
    const source = this.vault;
    const sourceId = this.session?.descriptor.id;
    if (!source) return false;
    await this.flushSave();

    if (destination.vault.id === sourceId) {
      const moved = await this.attempt(() =>
        kind === "note"
          ? source.moveNote(path, destination.folder).then((note) => note.path)
          : source.moveFolder(path, destination.folder),
      );
      if (moved === undefined) return false;
      if (kind === "note" && path === this.selectedNotePath) await this.openNote(moved);
      if (kind === "folder") this.#followFolder(path, moved);
      return true;
    }

    const moved = await this.attempt(async () => {
      const target = (await this.registry.open(destination.vault)).vault;
      return moveToVault(source, path, target, destination.folder);
    });
    if (moved === undefined) return false;
    if (kind === "note" && path === this.selectedNotePath) {
      this.selectedNotePath = null;
      this.pane = "list";
    }
    if (kind === "folder") this.#forgetFolder(path);
    return true;
  }

  async foldersOf(descriptor: VaultDescriptor): Promise<string[]> {
    if (descriptor.id === this.session?.descriptor.id) return this.folders;
    const opened = await this.attempt(() => this.registry.open(descriptor));
    return opened?.vault.folders() ?? [];
  }

  restoreFromTrash(id: string): Promise<void> {
    return this.#withVault((vault) => vault.restoreFromTrash(id));
  }

  deleteFromTrash(id: string): Promise<void> {
    return this.#withVault((vault) => vault.deleteFromTrash(id));
  }

  emptyTrash(): Promise<void> {
    return this.#withVault((vault) => vault.emptyTrash());
  }

  resolveImage(source: string): Promise<string> {
    return this.#attachments?.resolve(source) ?? Promise.resolve("");
  }

  saveImage(data: Uint8Array, fileName: string): Promise<string> {
    if (!this.vault) return Promise.reject(new Error("Aucun vault ouvert"));
    return this.vault.saveAttachment(data, fileName);
  }

  async #withVault(action: (vault: Vault) => Promise<unknown>): Promise<void> {
    const vault = this.vault;
    if (vault) await this.attempt(() => action(vault));
  }

  #followFolder(from: string, to: string): void {
    if (this.selectedNotePath && isSameOrInside(this.selectedNotePath, from)) {
      this.selectedNotePath = to + this.selectedNotePath.slice(from.length);
    }
    if (this.scope.kind === "folder" && isSameOrInside(this.scope.path, from)) {
      this.scope = { kind: "folder", path: to + this.scope.path.slice(from.length) };
    }
  }

  #forgetFolder(path: string): void {
    if (this.selectedNotePath && isSameOrInside(this.selectedNotePath, path)) {
      clearTimeout(this.#saveTimer);
      this.selectedNotePath = null;
      this.pane = "list";
    }
    if (this.scope.kind === "folder" && isSameOrInside(this.scope.path, path)) {
      this.scope = { kind: "folder", path: parentPath(path) };
    }
  }

  #scheduleSave(): void {
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => this.flushSave(), SAVE_DELAY_MS);
  }

  #reloadOpenNote(): void {
    if (!this.selectedNotePath) return;
    const fresh = this.vault?.getNote(this.selectedNotePath);

    if (!fresh) {
      this.selectedNotePath = null;
      this.pane = "list";
    } else if (fresh.content !== this.draftContent || fresh.tags.join() !== this.draftTags.join()) {
      this.draftContent = fresh.content;
      this.draftTags = fresh.tags;
      this.editorGeneration++;
    }
  }

  #closeSession(): void {
    clearTimeout(this.#saveTimer);
    this.#scheduler?.stop();
    this.#stopWatching?.();
    this.#unsubscribe?.();
    this.#attachments?.dispose();
    this.#scheduler = undefined;
    this.#stopWatching = undefined;
    this.#unsubscribe = undefined;
    this.#attachments = undefined;
    this.syncStatus = null;
    this.session = null;
  }

  #track<T>(read: (vault: Vault) => T, fallback: T): T {
    this.#version;
    const vault = this.session?.vault;
    return vault ? read(vault) : fallback;
  }
}

export function folderLabel(path: string): string {
  return path === "" ? "Notes" : path.split("/").at(-1)!;
}

export function folderPathLabel(path: string): string {
  return path === "" ? "Notes" : path.split("/").join(" › ");
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    return;
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
