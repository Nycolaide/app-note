export type RemoteKind = "file" | "directory";

export interface RemoteEntry {
  path: string;
  kind: RemoteKind;
  fingerprint: string;
}

export interface RemoteStorage {
  listAll(): Promise<RemoteEntry[]>;
  download(path: string): Promise<Uint8Array<ArrayBuffer>>;
  upload(path: string, data: Uint8Array<ArrayBuffer>): Promise<string>;
  createDirectory(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
}

export function encodePath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}
