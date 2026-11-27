import type { Vault } from "$lib/core";

const EXTERNAL_SOURCE = /^(https?:|data:|blob:)/i;

const IMAGE_TYPES: Record<string, string> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

export interface AttachmentUrls {
  resolve(source: string): Promise<string>;
  preload(path: string, data: Uint8Array): void;
  forget(path: string): void;
  dispose(): void;
}

function toObjectUrl(path: string, data: Uint8Array): string {
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
  return URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], { type: IMAGE_TYPES[extension] ?? "" }));
}

export function createAttachmentUrls(vault: Vault): AttachmentUrls {
  const cache = new Map<string, Promise<string>>();

  async function load(path: string): Promise<string> {
    return toObjectUrl(path, await vault.readAttachment(path));
  }

  return {
    resolve(source) {
      if (EXTERNAL_SOURCE.test(source)) return Promise.resolve(source);
      if (!vault.isAttachment(source)) return Promise.resolve("");

      let url = cache.get(source);

      if (!url) {
        url = load(source);
        url.catch(() => cache.delete(source));
        cache.set(source, url);
      }

      return url.catch(() => "");
    },

    preload(path, data) {
      cache.set(path, Promise.resolve(toObjectUrl(path, data)));
    },

    forget(path) {
      cache.get(path)?.then(URL.revokeObjectURL, () => undefined);
      cache.delete(path);
    },

    dispose() {
      for (const url of cache.values()) {
        url.then(URL.revokeObjectURL, () => undefined);
      }
      cache.clear();
    },
  };
}
