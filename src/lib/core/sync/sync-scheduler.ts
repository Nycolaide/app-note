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
  intervalMs?: number;
  afterChangeDelayMs?: number;
}

const DEFAULT_INTERVAL_MS = 5 * 60_000;
const DEFAULT_AFTER_CHANGE_DELAY_MS = 10_000;

export class SyncScheduler {
  readonly #options: SyncSchedulerOptions;
  #status: SyncStatus = { running: false, lastSuccess: null, lastError: null, lastReport: null };
  #pending = false;
  #stopped = false;
  #interval: ReturnType<typeof setInterval> | undefined;
  #debounce: ReturnType<typeof setTimeout> | undefined;
  #unsubscribe: (() => void) | undefined;

  constructor(options: SyncSchedulerOptions) {
    this.#options = options;
  }

  start(): void {
    const { vault, intervalMs = DEFAULT_INTERVAL_MS, afterChangeDelayMs = DEFAULT_AFTER_CHANGE_DELAY_MS } = this.#options;

    this.#unsubscribe = vault.onChange((origin) => {
      if (origin !== "local") return;
      clearTimeout(this.#debounce);
      this.#debounce = setTimeout(() => this.syncNow(), afterChangeDelayMs);
    });
    this.#interval = setInterval(() => this.syncNow(), intervalMs);
    this.syncNow();
  }

  stop(): void {
    this.#stopped = true;
    this.#unsubscribe?.();
    clearInterval(this.#interval);
    clearTimeout(this.#debounce);
  }

  async syncNow(): Promise<void> {
    if (this.#stopped) return;

    if (this.#status.running) {
      this.#pending = true;
      return;
    }

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

    if (this.#pending) {
      this.#pending = false;
      await this.syncNow();
    }
  }

  #update(changes: Partial<SyncStatus>): void {
    this.#status = { ...this.#status, ...changes };
    if (!this.#stopped) this.#options.onStatus(this.#status);
  }
}
