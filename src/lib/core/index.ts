export type { Note, NoteMeta } from "./note";
export type { StorageEntry, StorageProvider } from "./storage/provider";
export type { FolderNode, NoteChanges, TagCount, TrashEntry, TrashKind } from "./vault";
export type { SyncReport } from "./sync/sync-engine";
export { SyncScheduler, type SyncStatus } from "./sync/sync-scheduler";
export type { ChangeOrigin } from "./vault";
export { Vault } from "./vault";
export {
  VaultRegistry,
  type ConnectRequest,
  type RemoteConfig,
  type VaultDescriptor,
  type VaultSession,
} from "./vaults";
export { parentPath } from "./path";
export { createLinkPreviews, type LinkPreview, type LinkPreviews } from "./link-preview";
