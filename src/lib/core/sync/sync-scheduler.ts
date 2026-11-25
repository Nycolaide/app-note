import type { Vault } from "../vault";
import type { SyncReport } from "./sync-engine";

export interface SyncStatus {
  running: boolean;
  lastSuccess: Date | null;
  lastError: string | null;
  lastReport: SyncReport | null;
}

export interface SyncSchedulerOptions {
  vault: Vault;
  sync: () => Promise<SyncReport>;
  beforeSync: () => Promise<void>;
  onStatus: (status: SyncStatus) => void;
  onSynced: (report: SyncReport) => void;
  afterChangeDelayMs?: number;
}

const DEFAULT_AFTER_CHANGE_DELAY_MS = 10_000;

export class SyncScheduler {
  readonly #options: SyncSchedulerOptions;
  #status: SyncStatus = { running: false, lastSuccess: null, lastError: null, lastReport: null };
  #pending = false;
  #current: Promise<void> | null = null;
  #stopped = false;
  #debounce: ReturnType<typeof setTimeout> | undefined;
  #unsubscribe: (() => void) | undefined;

  constructor(options: SyncSchedulerOptions) {
    this.#options = options;
  }

  start(): void {
    const { vault, afterChangeDelayMs = DEFAULT_AFTER_CHANGE_DELAY_MS } = this.#options;

    this.#unsubscribe = vault.onChange((origin) => {
      if (origin !== "local") return;
      clearTimeout(this.#debounce);
      this.#debounce = setTimeout(() => this.syncNow(), afterChangeDelayMs);
    });
    this.syncNow();
  }

  stop(): void {
    this.#stopped = true;
    this.#unsubscribe?.();
    clearTimeout(this.#debounce);
  }

  syncNow(): Promise<void> {
    if (this.#stopped) return Promise.resolve();

    if (this.#current) {
      this.#pending = true;
      return this.#current;
    }

    this.#current = this.#runUntilSettled().finally(() => (this.#current = null));
    return this.#current;
  }

  async #runUntilSettled(): Promise<void> {
    do {
      this.#pending = false;
      await this.#runOnce();
    } while (this.#pending && !this.#stopped);
  }

  async #runOnce(): Promise<void> {
    clearTimeout(this.#debounce);
    this.#update({ running: true });

    try {
      await this.#options.beforeSync();
      const report = await this.#options.sync();
      this.#update({ lastSuccess: new Date(), lastError: null, lastReport: report });
      if (!this.#stopped) this.#options.onSynced(report);
    } catch (cause) {
      this.#update({ lastError: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      this.#update({ running: false });
    }
  }

  #update(changes: Partial<SyncStatus>): void {
    this.#status = { ...this.#status, ...changes };
    if (!this.#stopped) this.#options.onStatus(this.#status);
  }
}
