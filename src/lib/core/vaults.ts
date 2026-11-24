import { GoogleAuth, type GoogleClient } from "./remote/google-auth";
import { GoogleDriveClient, GoogleDriveStorage, type DriveFolder } from "./remote/google-drive";
import type { RemoteStorage } from "./remote/remote";
import { WebDavStorage, type WebDavCredentials } from "./remote/webdav";
import { LocalStorageProvider } from "./storage/local";
import { SyncEngine, type SyncReport } from "./sync/sync-engine";
import { Vault } from "./vault";

export type RemoteConfig =
  | { kind: "webdav"; url: string; username: string }
  | { kind: "google-drive"; folderId: string; account: string };

export interface VaultDescriptor {
  id: string;
  name: string;
  remote: RemoteConfig | null;
}

export interface ConnectRequest extends WebDavCredentials {
  name: string;
}

export interface GoogleDriveConnection {
  refreshToken: string;
  account: string;
  folders: DriveFolder[];
}

export interface GoogleDriveConnectRequest {
  refreshToken: string;
  account: string;
  folder: DriveFolder | { name: string };
}

export interface VaultSession {
  descriptor: VaultDescriptor;
  vault: Vault;
  sync: (() => Promise<SyncReport>) | null;
}

interface Secret {
  password?: string;
  refreshToken?: string;
}

export interface VaultRegistryOptions {
  google: GoogleClient | null;
}

const CONFIG_DIRECTORY = "config";
const VAULTS_FILE = "vaults.json";
const SECRETS_FILE = "secrets.json";
const LOCAL_NOTES_DIRECTORY = "notes";
const MIRRORS_DIRECTORY = "vaults";
const LOCAL_VAULT: VaultDescriptor = { id: "local", name: "Local", remote: null };

export class VaultRegistry {
  readonly #config = new LocalStorageProvider(CONFIG_DIRECTORY);
  readonly #mirrors = new LocalStorageProvider(MIRRORS_DIRECTORY);
  readonly #google: GoogleClient | null;

  constructor(options: VaultRegistryOptions = { google: null }) {
    this.#google = options.google;
  }

  get googleDriveAvailable(): boolean {
    return this.#google !== null;
  }

  async list(): Promise<VaultDescriptor[]> {
    return [LOCAL_VAULT, ...(await this.#remoteVaults())];
  }

  async open(descriptor: VaultDescriptor): Promise<VaultSession> {
    const storage = new LocalStorageProvider(mirrorRoot(descriptor));
    const vault = new Vault(storage);
    await vault.load();

    if (!descriptor.remote) {
      return { descriptor, vault, sync: null };
    }

    const remote = this.#remoteStorage(descriptor.remote, (await this.#secrets())[descriptor.id] ?? {});
    const engine = new SyncEngine(storage, remote);
    const sync = () => vault.synchronize(() => engine.run(), changedLocally);
    return { descriptor, vault, sync };
  }

  async connect({ name, url, username, password }: ConnectRequest): Promise<VaultDescriptor> {
    await new WebDavStorage({ url, username, password }).listAll();

    return this.#save({ id: crypto.randomUUID(), name: name.trim() || "Sans nom", remote: { kind: "webdav", url, username } }, { password });
  }

  async inspectGoogleDrive(refreshToken: string): Promise<GoogleDriveConnection> {
    const drive = this.#driveClient(refreshToken);
    const [account, folders] = await Promise.all([drive.accountEmail(), drive.vaultFolders()]);
    return { refreshToken, account, folders };
  }

  async connectGoogleDrive({ refreshToken, account, folder }: GoogleDriveConnectRequest): Promise<VaultDescriptor> {
    const name = folder.name.trim() || "Sans nom";
    const target = "id" in folder ? folder : await this.#driveClient(refreshToken).createVaultFolder(name);
    const remote: RemoteConfig = { kind: "google-drive", folderId: target.id, account };
    return this.#save({ id: crypto.randomUUID(), name: target.name, remote }, { refreshToken });
  }

  async #save(descriptor: VaultDescriptor, secret: Secret): Promise<VaultDescriptor> {
    await this.#write(SECRETS_FILE, { ...(await this.#secrets()), [descriptor.id]: secret });
    await this.#write(VAULTS_FILE, [...(await this.#remoteVaults()), descriptor]);
    return descriptor;
  }

  #remoteStorage(config: RemoteConfig, secret: Secret): RemoteStorage {
    if (config.kind === "google-drive") {
      return new GoogleDriveStorage(this.#driveClient(secret.refreshToken ?? ""), config.folderId);
    }
    return new WebDavStorage({ url: config.url, username: config.username, password: secret.password ?? "" });
  }

  #driveClient(refreshToken: string): GoogleDriveClient {
    if (!this.#google) {
      throw new Error("Google Drive n'est pas configuré dans cette version de Runote.");
    }
    return new GoogleDriveClient(new GoogleAuth(this.#google, refreshToken));
  }

  async remove(id: string): Promise<void> {
    if (id === LOCAL_VAULT.id) {
      throw new Error("Le vault local ne peut pas être supprimé.");
    }

    await this.#write(VAULTS_FILE, (await this.#remoteVaults()).filter((vault) => vault.id !== id));
    const secrets = await this.#secrets();
    delete secrets[id];
    await this.#write(SECRETS_FILE, secrets);
    await this.#mirrors.remove(id).catch(() => undefined);
  }

  #remoteVaults(): Promise<VaultDescriptor[]> {
    return this.#read<VaultDescriptor[]>(VAULTS_FILE, []);
  }

  #secrets(): Promise<Record<string, Secret>> {
    return this.#read<Record<string, Secret>>(SECRETS_FILE, {});
  }

  async #read<T>(file: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await this.#config.readText(file));
    } catch {
      return fallback;
    }
  }

  async #write(file: string, value: unknown): Promise<void> {
    await this.#config.createDirectory("");
    await this.#config.writeText(file, JSON.stringify(value, null, 2));
  }
}

function mirrorRoot(descriptor: VaultDescriptor): string {
  return descriptor.remote ? `${MIRRORS_DIRECTORY}/${descriptor.id}` : LOCAL_NOTES_DIRECTORY;
}

function changedLocally(report: SyncReport): boolean {
  return report.downloaded + report.deletedLocally + report.movedLocally > 0;
}
