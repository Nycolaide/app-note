import {
  BaseDirectory,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  rename,
  stat,
  watch,
  writeFile,
  writeTextFile,
  type WatchEventKind,
} from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import { baseName, joinPath, parentPath } from "../path";
import type { StorageEntry, StorageProvider, StorageStat } from "./provider";

const baseDir = BaseDirectory.AppData;
const WATCH_DELAY_MS = 500;

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

  async stat(path: string): Promise<StorageStat> {
    const info = await stat(this.#resolve(path), { baseDir });
    return { size: info.size, modified: info.mtime?.getTime() ?? 0 };
  }

  readText(path: string): Promise<string> {
    return readTextFile(this.#resolve(path), { baseDir });
  }

  writeText(path: string, content: string): Promise<void> {
    return this.#writeAtomically(path, (temporary) => writeTextFile(temporary, content, { baseDir }));
  }

  readBinary(path: string): Promise<Uint8Array<ArrayBuffer>> {
    return readFile(this.#resolve(path), { baseDir });
  }

  writeBinary(path: string, data: Uint8Array): Promise<void> {
    return this.#writeAtomically(path, (temporary) => writeFile(temporary, data, { baseDir }));
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

  async watch(listener: (paths: string[]) => void): Promise<() => void> {
    const root = toForwardSlashes(await join(await appDataDir(), ...this.#root.split("/")));

    return watch(
      this.#root,
      (event) => {
        if (isReadOnlyAccess(event.type)) return;
        const paths = event.paths
          .map(toForwardSlashes)
          .filter((path) => path.startsWith(`${root}/`))
          .map((path) => path.slice(root.length + 1));

        if (paths.length > 0) listener(paths);
      },
      { baseDir, recursive: true, delayMs: WATCH_DELAY_MS },
    );
  }

  async #writeAtomically(path: string, write: (temporary: string) => Promise<void>): Promise<void> {
    const target = this.#resolve(path);
    const temporary = joinPath(parentPath(target), `.${baseName(target)}.tmp`);

    await write(temporary);
    await rename(temporary, target, { oldPathBaseDir: baseDir, newPathBaseDir: baseDir });
  }

  #resolve(path: string): string {
    return joinPath(this.#root, path);
  }
}

function isReadOnlyAccess(kind: WatchEventKind): boolean {
  return typeof kind === "object" && "access" in kind;
}

function toForwardSlashes(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}
