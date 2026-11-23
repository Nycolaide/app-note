export type EntryKind = "file" | "directory";

export interface StorageEntry {
  name: string;
  kind: EntryKind;
}

export interface StorageProvider {
  list(path: string): Promise<StorageEntry[]>;
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  createDirectory(path: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}
