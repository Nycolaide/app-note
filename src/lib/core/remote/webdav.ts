import { defaultFetcher, expectOk, readBytes, type Fetcher } from "../http";
import { encodePath, type RemoteEntry, type RemoteStorage } from "./remote";

export interface WebDavCredentials {
  url: string;
  username: string;
  password: string;
}

const DAV_NAMESPACE = "DAV:";
const NOT_FOUND = 404;
const METHOD_NOT_ALLOWED = 405;

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop><d:resourcetype/><d:getetag/><d:getlastmodified/><d:getcontentlength/></d:prop>
</d:propfind>`;

export class WebDavStorage implements RemoteStorage {
  readonly #base: URL;
  readonly #authorization: string;
  readonly #fetch: Fetcher;

  constructor(credentials: WebDavCredentials, fetcher: Fetcher = defaultFetcher) {
    this.#base = new URL(credentials.url.endsWith("/") ? credentials.url : `${credentials.url}/`);
    this.#authorization = `Basic ${toBase64(`${credentials.username}:${credentials.password}`)}`;
    this.#fetch = fetcher;
  }

  async listAll(): Promise<RemoteEntry[]> {
    const entries: RemoteEntry[] = [];
    const pending = [""];

    while (pending.length > 0) {
      const directory = pending.pop()!;

      for (const entry of await this.#propfind(directory, "1")) {
        if (entry.path === directory) continue;
        entries.push(entry);
        if (entry.kind === "directory") pending.push(entry.path);
      }
    }

    return entries;
  }

  async download(path: string): Promise<Uint8Array<ArrayBuffer>> {
    return readBytes(await this.#request("GET", path));
  }

  async upload(path: string, data: Uint8Array<ArrayBuffer>): Promise<string> {
    const response = await this.#request("PUT", path, {
      headers: { "Content-Type": "application/octet-stream" },
      body: data,
    });
    const etag = response.headers.get("oc-etag") ?? response.headers.get("etag");

    if (etag) {
      return normalizeEtag(etag);
    }

    const [entry] = await this.#propfind(path, "0");
    return entry?.fingerprint ?? "";
  }

  async createDirectory(path: string): Promise<void> {
    await this.#request("MKCOL", path, {}, { directory: true, allowed: [METHOD_NOT_ALLOWED] });
  }

  async remove(path: string): Promise<void> {
    await this.#request("DELETE", path, {}, { allowed: [NOT_FOUND] });
  }

  async #propfind(path: string, depth: "0" | "1"): Promise<RemoteEntry[]> {
    const response = await this.#request(
      "PROPFIND",
      path,
      {
        headers: { Depth: depth, "Content-Type": "application/xml; charset=utf-8" },
        body: PROPFIND_BODY,
      },
      { directory: depth === "1" },
    );

    return this.#parseMultistatus(await response.text());
  }

  #parseMultistatus(xml: string): RemoteEntry[] {
    const document = new DOMParser().parseFromString(xml, "application/xml");

    return davElements(document, "response").flatMap((response) => {
      const path = this.#relativePath(davText(response, "href"));
      if (path === null) return [];

      const isDirectory = davElements(response, "collection").length > 0;
      const etag = davText(response, "getetag");
      const fingerprint = etag
        ? normalizeEtag(etag)
        : `${davText(response, "getlastmodified")}|${davText(response, "getcontentlength")}`;

      return [{ path, kind: isDirectory ? "directory" : "file", fingerprint }];
    });
  }

  #relativePath(href: string): string | null {
    try {
      const target = decodeURIComponent(new URL(href, this.#base).pathname);
      const base = decodeURIComponent(this.#base.pathname);
      return target.startsWith(base) ? target.slice(base.length).replace(/\/+$/, "") : null;
    } catch {
      return null;
    }
  }

  async #request(
    method: string,
    path: string,
    init: RequestInit = {},
    options: { directory?: boolean; allowed?: number[] } = {},
  ): Promise<Response> {
    const encoded = encodePath(path);
    const suffix = options.directory && encoded ? "/" : "";
    const url = new URL(`${encoded}${suffix}`, this.#base).href;

    const response = await this.#fetch(url, {
      ...init,
      method,
      headers: { ...init.headers, Authorization: this.#authorization },
    });

    return expectOk(response, `WebDAV ${method} ${path || "/"}`, options.allowed);
  }
}

function davElements(parent: Document | Element, name: string): Element[] {
  return [...parent.getElementsByTagName("*")].filter(
    (element) => element.namespaceURI === DAV_NAMESPACE && element.localName === name,
  );
}

function davText(parent: Element, name: string): string {
  return davElements(parent, name)[0]?.textContent?.trim() ?? "";
}

function normalizeEtag(etag: string): string {
  return etag.replace(/^W\//, "").replace(/"/g, "");
}

function toBase64(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}
