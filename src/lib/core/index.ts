import { LocalStorageProvider } from "./storage/local";
import { Vault } from "./vault";

export type { Note, NoteMeta } from "./note";
export type { StorageEntry, StorageProvider } from "./storage/provider";
export type { FolderNode, NoteChanges, TagCount, TrashEntry, TrashKind } from "./vault";
export { Vault };
export { parentPath } from "./path";
export { createLinkPreviews, type LinkPreview, type LinkPreviews } from "./link-preview";

const LOCAL_NOTES_DIRECTORY = "notes";

export async function openLocalVault(): Promise<Vault> {
  const vault = new Vault(new LocalStorageProvider(LOCAL_NOTES_DIRECTORY));
  await vault.load();
  return vault;
}
