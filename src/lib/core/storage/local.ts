import {
  BaseDirectory,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { baseName, joinPath, parentPath } from "../path";
import type { StorageEntry, StorageProvider } from "./provider";

const baseDir = BaseDirectory.AppData;

export class LocalStorageProvider implements StorageProvider {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  async list(path: string): Promise<StorageEntry[]> {
    const entries = await readDir(this.#resolve(path), { baseDir });

    return entries
      .filter((entry) => entry.isFile || entry.isDirectory)
      .map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory ? "directory" : "file",
      }));
  }

  readText(path: string): Promise<string> {
    return readTextFile(this.#resolve(path), { baseDir });
  }

  async writeText(path: string, content: string): Promise<void> {
    const target = this.#resolve(path);
    const temporary = joinPath(parentPath(target), `.${baseName(target)}.tmp`);

    await writeTextFile(temporary, content, { baseDir });
    await rename(temporary, target, { oldPathBaseDir: baseDir, newPathBaseDir: baseDir });
  }

  createDirectory(path: string): Promise<void> {
    return mkdir(this.#resolve(path), { baseDir, recursive: true });
  }

  move(from: string, to: string): Promise<void> {
    return rename(this.#resolve(from), this.#resolve(to), {
      oldPathBaseDir: baseDir,
      newPathBaseDir: baseDir,
    });
  }

  remove(path: string): Promise<void> {
    return remove(this.#resolve(path), { baseDir, recursive: true });
  }

  #resolve(path: string): string {
    return joinPath(this.#root, path);
  }
}
