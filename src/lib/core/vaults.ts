import { WebDavStorage, type WebDavCredentials } from "./remote/webdav";
import { LocalStorageProvider } from "./storage/local";
import { SyncEngine, type SyncReport } from "./sync/sync-engine";
import { Vault } from "./vault";

export interface RemoteConfig {
  kind: "webdav";
  url: string;
  username: string;
}

export interface VaultDescriptor {
  id: string;
  name: string;
  remote: RemoteConfig | null;
}

export interface ConnectRequest extends WebDavCredentials {
  name: string;
}

export interface VaultSession {
  descriptor: VaultDescriptor;
  vault: Vault;
  sync: (() => Promise<SyncReport>) | null;
}

interface Secret {
  password: string;
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

    const { password } = (await this.#secrets())[descriptor.id] ?? { password: "" };
    const remote = new WebDavStorage({ url: descriptor.remote.url, username: descriptor.remote.username, password });
    const engine = new SyncEngine(storage, remote);
    const sync = () => vault.synchronize(() => engine.run(), changedLocally);
    return { descriptor, vault, sync };
  }

  async connect({ name, url, username, password }: ConnectRequest): Promise<VaultDescriptor> {
    await new WebDavStorage({ url, username, password }).listAll();

    const descriptor: VaultDescriptor = {
      id: crypto.randomUUID(),
      name: name.trim() || "Sans nom",
      remote: { kind: "webdav", url, username },
    };

    await this.#write(SECRETS_FILE, { ...(await this.#secrets()), [descriptor.id]: { password } });
    await this.#write(VAULTS_FILE, [...(await this.#remoteVaults()), descriptor]);
    return descriptor;
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
