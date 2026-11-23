import { attachmentReferences, replaceAttachmentReference } from "./attachment-references";
import { baseName, joinPath, parentPath } from "./path";
import type { Note } from "./note";
import type { Vault } from "./vault";

const ATTACHMENTS = "attachments";

export async function moveToVault(source: Vault, path: string, target: Vault, targetFolder: string): Promise<string> {
  const transfer = new Transfer(source, target);

  if (source.getNote(path)) {
    const copied = await transfer.copyNote(path, targetFolder);
    await source.trashNote(path);
    return copied.path;
  }

  if (path !== "" && source.folders().includes(path)) {
    const copied = await transfer.copyFolder(path, targetFolder);
    await source.trashFolder(path);
    return copied;
  }

  throw new Error(`Élément introuvable : ${path || "racine"}`);
}

class Transfer {
  readonly #source: Vault;
  readonly #target: Vault;
  readonly #attachments = new Map<string, Promise<string | null>>();

  constructor(source: Vault, target: Vault) {
    this.#source = source;
    this.#target = target;
  }

  async copyFolder(path: string, targetParent: string): Promise<string> {
    const created = await this.#target.createFolder(targetParent, baseName(path), "rename");

    for (const note of this.#source.notesIn(path)) {
      await this.copyNote(note.path, created);
    }

    for (const child of this.#source.folders().filter((folder) => folder !== "" && parentPath(folder) === path)) {
      await this.copyFolder(child, created);
    }

    return created;
  }

  async copyNote(path: string, targetFolder: string): Promise<Note> {
    const note = this.#source.getNote(path);

    if (!note) {
      throw new Error(`Note introuvable : ${path}`);
    }

    let content = note.content;

    for (const name of attachmentReferences(note.content)) {
      const copied = await this.#copyAttachment(name);
      if (copied && copied !== name) content = replaceAttachmentReference(content, name, copied);
    }

    return this.#target.importNote(targetFolder, { ...note, content });
  }

  #copyAttachment(name: string): Promise<string | null> {
    let copied = this.#attachments.get(name);

    if (!copied) {
      copied = this.#source.readAttachment(joinPath(ATTACHMENTS, name)).then(
        async (data) => baseName(await this.#target.importAttachment(name, data)),
        () => null,
      );
      this.#attachments.set(name, copied);
    }

    return copied;
  }
}
