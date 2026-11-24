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
  dispose(): void;
}

export function createAttachmentUrls(vault: Vault): AttachmentUrls {
  const cache = new Map<string, Promise<string>>();

  async function load(path: string): Promise<string> {
    const data = await vault.readAttachment(path);
    const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
    return URL.createObjectURL(new Blob([data], { type: IMAGE_TYPES[extension] ?? "" }));
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

    dispose() {
      for (const url of cache.values()) {
        url.then(URL.revokeObjectURL, () => undefined);
      }
      cache.clear();
    },
  };
}
