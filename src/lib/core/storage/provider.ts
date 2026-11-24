export type EntryKind = "file" | "directory";

export interface StorageEntry {
  name: string;
  kind: EntryKind;
}

export interface StorageStat {
  size: number;
  modified: number;
}

export interface StorageProvider {
  list(path: string): Promise<StorageEntry[]>;
  stat(path: string): Promise<StorageStat>;
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  readBinary(path: string): Promise<Uint8Array<ArrayBuffer>>;
  writeBinary(path: string, data: Uint8Array): Promise<void>;
  createDirectory(path: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  watch?(listener: (paths: string[]) => void): Promise<() => void>;
}
