export type { Note, NoteMeta } from "./note";
export type { StorageEntry, StorageProvider } from "./storage/provider";
export type { CleanupReport, FolderNode, NoteChanges, TagCount, TrashEntry, TrashKind } from "./vault";
export type { SyncReport } from "./sync/sync-engine";
export { SyncScheduler, type SyncStatus } from "./sync/sync-scheduler";
export type { ChangeOrigin } from "./vault";
export { Vault } from "./vault";
export {
  VaultRegistry,
  type ConnectRequest,
  type GoogleDriveConnection,
  type GoogleDriveConnectRequest,
  type RemoteConfig,
  type VaultDescriptor,
  type VaultSession,
} from "./vaults";
export { isSameOrInside, parentPath } from "./path";
export { moveToVault } from "./transfer";
export {
  createLinkPreviewFileStore,
  createLinkPreviews,
  type LinkPreview,
  type LinkPreviews,
} from "./link-preview";
export {
  authorizationUrl,
  createPkce,
  exchangeCode,
  randomState,
  type GoogleClient,
} from "./remote/google-auth";
export type { DriveFolder } from "./remote/google-drive";
