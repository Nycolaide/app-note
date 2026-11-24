import { defaultFetcher, expectOk, readBytes, type Fetcher } from "../http";
import { baseName, joinPath, parentPath } from "../path";
import type { GoogleAuth } from "./google-auth";
import type { RemoteEntry, RemoteKind, RemoteStorage } from "./remote";

export interface DriveFolder {
  id: string;
  name: string;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  md5Checksum?: string;
  modifiedTime?: string;
}

interface DriveNode {
  id: string;
  kind: RemoteKind;
}

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const APP_FOLDER_NAME = "Runote";
const FILE_FIELDS = "id,name,mimeType,parents,md5Checksum,modifiedTime";
const PAGE_SIZE = 1000;
const NOT_FOUND = 404;
const RETRYABLE = [429, 500, 502, 503, 504];
const MAX_ATTEMPTS = 4;
const RETRY_BASE_MS = 500;

export class GoogleDriveClient {
  readonly #auth: GoogleAuth;
  readonly #fetch: Fetcher;
  readonly #wait: (ms: number) => Promise<void>;

  constructor(auth: GoogleAuth, fetcher: Fetcher = defaultFetcher, wait = sleep) {
    this.#auth = auth;
    this.#fetch = fetcher;
    this.#wait = wait;
  }

  async accountEmail(): Promise<string> {
    const response = await this.request(`${API}/about?fields=user(emailAddress)`, {}, "Compte Google");
    const body: { user?: { emailAddress?: string } } = await response.json();
    return body.user?.emailAddress ?? "";
  }

  async vaultFolders(): Promise<DriveFolder[]> {
    const appFolder = await this.findChild("root", APP_FOLDER_NAME, true);
    if (!appFolder) return [];
    const folders = await this.listFiles(`'${appFolder.id}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`);
    return folders.map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }

  async createVaultFolder(name: string): Promise<DriveFolder> {
    const appFolder = (await this.findChild("root", APP_FOLDER_NAME, true)) ?? (await this.createFolder("root", APP_FOLDER_NAME));
    const existing = await this.findChild(appFolder.id, name, true);
    return existing ? { id: existing.id, name: existing.name } : this.createFolder(appFolder.id, name);
  }

  async listFiles(query: string): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken = "";

    do {
      const params = new URLSearchParams({
        q: query,
        fields: `nextPageToken,files(${FILE_FIELDS})`,
        pageSize: String(PAGE_SIZE),
        spaces: "drive",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const response = await this.request(`${API}/files?${params}`, {}, "Google Drive : liste des fichiers");
      const body: { files: DriveFile[]; nextPageToken?: string } = await response.json();
      files.push(...body.files);
      pageToken = body.nextPageToken ?? "";
    } while (pageToken);

    return files;
  }

  async createFolder(parentId: string, name: string): Promise<DriveFolder> {
    const response = await this.request(
      `${API}/files?fields=id,name`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
      },
      `Google Drive : création du dossier ${name}`,
    );
    return response.json();
  }

  async request(url: string, init: RequestInit, context: string, allowed: number[] = []): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      const response = await this.#fetch(url, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${await this.#auth.accessToken()}` },
      });

      if (response.status === 401 && attempt === 1) {
        this.#auth.invalidate();
        continue;
      }

      if ((RETRYABLE.includes(response.status) || (await isRateLimited(response))) && attempt < MAX_ATTEMPTS) {
        await this.#wait(RETRY_BASE_MS * 2 ** (attempt - 1));
        continue;
      }

      return expectOk(response, context, allowed);
    }
  }

  async findChild(parentId: string, name: string, folder?: boolean): Promise<DriveFile | undefined> {
    const type = folder === undefined ? "" : ` and mimeType ${folder ? "=" : "!="} '${FOLDER_MIME}'`;
    const [match] = await this.listFiles(`'${parentId}' in parents and name = '${escapeQuery(name)}'${type} and trashed = false`);
    return match;
  }
}

export class GoogleDriveStorage implements RemoteStorage {
  readonly #client: GoogleDriveClient;
  readonly #rootId: string;
  #nodes = new Map<string, DriveNode>();

  constructor(client: GoogleDriveClient, rootId: string) {
    this.#client = client;
    this.#rootId = rootId;
    this.#nodes.set("", { id: rootId, kind: "directory" });
  }

  async listAll(): Promise<RemoteEntry[]> {
    const files = await this.#client.listFiles("trashed = false");
    const children = new Map<string, DriveFile[]>();

    for (const file of files) {
      for (const parent of file.parents ?? []) {
        children.set(parent, [...(children.get(parent) ?? []), file]);
      }
    }

    const nodes = new Map<string, DriveNode>([["", { id: this.#rootId, kind: "directory" }]]);
    const entries: RemoteEntry[] = [];
    const pending = [{ id: this.#rootId, path: "" }];

    while (pending.length > 0) {
      const { id, path } = pending.pop()!;

      for (const file of children.get(id) ?? []) {
        const childPath = joinPath(path, file.name);
        if (nodes.has(childPath)) continue;
        const kind: RemoteKind = file.mimeType === FOLDER_MIME ? "directory" : "file";
        nodes.set(childPath, { id: file.id, kind });
        entries.push({ path: childPath, kind, fingerprint: kind === "file" ? fingerprintOf(file) : "" });
        if (kind === "directory") pending.push({ id: file.id, path: childPath });
      }
    }

    this.#nodes = nodes;
    return entries;
  }

  async download(path: string): Promise<Uint8Array<ArrayBuffer>> {
    const { id } = await this.#require(path);
    return readBytes(await this.#client.request(`${API}/files/${id}?alt=media`, {}, `Google Drive : lecture de ${path}`));
  }

  async upload(path: string, data: Uint8Array<ArrayBuffer>): Promise<string> {
    const existing = await this.#find(path);
    const context = `Google Drive : envoi de ${path}`;

    if (existing) {
      const response = await this.#client.request(
        `${UPLOAD_API}/files/${existing.id}?uploadType=media&fields=${FILE_FIELDS}`,
        { method: "PATCH", headers: { "Content-Type": "application/octet-stream" }, body: data },
        context,
      );
      return fingerprintOf(await response.json());
    }

    const parent = await this.#require(parentPath(path));
    const boundary = `runote-${crypto.randomUUID()}`;
    const response = await this.#client.request(
      `${UPLOAD_API}/files?uploadType=multipart&fields=${FILE_FIELDS}`,
      {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body: multipartBody(boundary, { name: baseName(path), parents: [parent.id] }, data),
      },
      context,
    );
    const created: DriveFile = await response.json();
    this.#nodes.set(path, { id: created.id, kind: "file" });
    return fingerprintOf(created);
  }

  async createDirectory(path: string): Promise<void> {
    if (await this.#find(path)) return;
    const parent = await this.#require(parentPath(path));
    const created = await this.#client.createFolder(parent.id, baseName(path));
    this.#nodes.set(path, { id: created.id, kind: "directory" });
  }

  async remove(path: string): Promise<void> {
    const node = await this.#find(path);
    if (!node) return;

    await this.#client.request(
      `${API}/files/${node.id}?fields=id`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) },
      `Google Drive : suppression de ${path}`,
      [NOT_FOUND],
    );
    this.#forget(path);
  }

  async move(from: string, to: string): Promise<void> {
    const node = await this.#require(from);
    const oldParent = await this.#require(parentPath(from));
    const newParent = await this.#require(parentPath(to));
    const params = new URLSearchParams({ fields: "id" });

    if (oldParent.id !== newParent.id) {
      params.set("addParents", newParent.id);
      params.set("removeParents", oldParent.id);
    }

    await this.#client.request(
      `${API}/files/${node.id}?${params}`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: baseName(to) }) },
      `Google Drive : déplacement de ${from}`,
    );
    this.#rename(from, to);
  }

  async #require(path: string): Promise<DriveNode> {
    const node = await this.#find(path);
    if (!node) throw new Error(`Google Drive : ${path} est introuvable.`);
    return node;
  }

  async #find(path: string): Promise<DriveNode | undefined> {
    const known = this.#nodes.get(path);
    if (known) return known;

    const parent = await this.#find(parentPath(path));
    if (!parent || parent.kind !== "directory") return undefined;

    const file = await this.#client.findChild(parent.id, baseName(path));
    if (!file) return undefined;

    const node: DriveNode = { id: file.id, kind: file.mimeType === FOLDER_MIME ? "directory" : "file" };
    this.#nodes.set(path, node);
    return node;
  }

  #forget(path: string): void {
    for (const known of [...this.#nodes.keys()]) {
      if (known === path || known.startsWith(`${path}/`)) this.#nodes.delete(known);
    }
  }

  #rename(from: string, to: string): void {
    for (const [known, node] of [...this.#nodes]) {
      if (known === from || known.startsWith(`${from}/`)) {
        this.#nodes.delete(known);
        this.#nodes.set(to + known.slice(from.length), node);
      }
    }
  }
}

function fingerprintOf(file: DriveFile): string {
  return file.md5Checksum ?? file.modifiedTime ?? file.id;
}

function multipartBody(boundary: string, metadata: object, data: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + data.length + tail.length);
  body.set(head);
  body.set(data, head.length);
  body.set(tail, head.length + data.length);
  return body;
}

async function isRateLimited(response: Response): Promise<boolean> {
  if (response.status !== 403) return false;
  const detail = await response.clone().text().catch(() => "");
  return /rateLimitExceeded|userRateLimitExceeded/.test(detail);
}

function escapeQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
