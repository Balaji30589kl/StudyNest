import type { UpdateState } from '../../shared/ipc.js';

/** The subset of electron-updater's autoUpdater the service needs (faked in tests). */
export interface UpdaterAdapter {
  on(event: 'checking-for-update', listener: () => void): unknown;
  on(event: 'update-available', listener: (info: { version: string }) => void): unknown;
  on(event: 'update-not-available', listener: (info: { version: string }) => void): unknown;
  on(event: 'download-progress', listener: (progress: { percent: number }) => void): unknown;
  on(event: 'update-downloaded', listener: (info: { version: string }) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export type UpdateEnvironment = {
  currentVersion: string;
  isPackaged: boolean;
  isPortable: boolean;
};

export type UpdateServiceDeps = {
  environment: UpdateEnvironment;
  /** Created lazily so electron-updater is never loaded in development. */
  createUpdater: () => UpdaterAdapter;
  now?: () => number;
  log?: (level: 'info' | 'warn', message: string, data?: Record<string, unknown>) => void;
  initialDelayMs?: number;
  intervalMs?: number;
};

const SIX_HOURS = 6 * 60 * 60 * 1000;

function friendlyError(error: Error): string {
  const message = error.message || String(error);
  if (/app-update\.yml/i.test(message)) {
    return 'This build has no update feed. Install StudyNest with the Setup installer to get updates.';
  }
  if (/404|Not Found|no published versions|Cannot find latest/i.test(message)) {
    return 'No published release was found yet.';
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::ERR_/i.test(message)) {
    return "Couldn't reach the update server. Check your connection.";
  }
  return "Couldn't check for updates. Try again later.";
}

/**
 * Auto-update lifecycle for installed builds: check on start and every six
 * hours, download in the background, install on the next restart (or now, if
 * the user chooses). Development and portable builds report why they can't update.
 */
export class UpdateService {
  private state: UpdateState;
  private updater: UpdaterAdapter | null = null;
  private readonly listeners = new Set<() => void>();
  private timers: Array<ReturnType<typeof setTimeout>> = [];
  private readonly now: () => number;

  constructor(private readonly deps: UpdateServiceDeps) {
    this.now = deps.now ?? Date.now;
    const { environment } = deps;
    const disabledReason = !environment.isPackaged
      ? 'Updates work in the installed app, not in development builds.'
      : environment.isPortable
        ? "The portable version doesn't update itself. Download the latest version from the releases page."
        : null;
    this.state = disabledReason
      ? { status: 'disabled', currentVersion: environment.currentVersion, message: disabledReason }
      : { status: 'idle', currentVersion: environment.currentVersion };
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): UpdateState {
    return { ...this.state };
  }

  /** Starts background checks. No-op when updates are disabled. */
  start(): void {
    if (this.state.status === 'disabled') {
      return;
    }
    const first = setTimeout(() => void this.check(), this.deps.initialDelayMs ?? 15_000);
    const repeat = setInterval(() => void this.check(), this.deps.intervalMs ?? SIX_HOURS);
    this.timers.push(first, repeat as unknown as ReturnType<typeof setTimeout>);
  }

  stop(): void {
    for (const timer of this.timers) {
      clearTimeout(timer);
      clearInterval(timer as unknown as ReturnType<typeof setInterval>);
    }
    this.timers = [];
  }

  async check(): Promise<UpdateState> {
    if (this.state.status === 'disabled' || this.state.status === 'downloading' || this.state.status === 'downloaded') {
      return this.getState();
    }
    try {
      await this.getUpdater().checkForUpdates();
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
    return this.getState();
  }

  /** Restarts into the downloaded update. */
  installNow(): void {
    if (this.state.status === 'downloaded' && this.updater) {
      this.deps.log?.('info', 'installing update', { version: this.state.availableVersion });
      this.updater.quitAndInstall(false, true);
    }
  }

  private getUpdater(): UpdaterAdapter {
    if (this.updater) {
      return this.updater;
    }
    const updater = this.deps.createUpdater();
    updater.on('checking-for-update', () => this.set({ status: 'checking' }));
    updater.on('update-available', (info) => {
      this.deps.log?.('info', 'update available', { version: info.version });
      this.set({ status: 'downloading', availableVersion: info.version, percent: 0 });
    });
    updater.on('update-not-available', () => this.set({ status: 'up-to-date', lastCheckedAt: this.now() }));
    updater.on('download-progress', (progress) => this.set({ status: 'downloading', percent: Math.round(progress.percent) }));
    updater.on('update-downloaded', (info) => {
      this.deps.log?.('info', 'update downloaded', { version: info.version });
      this.set({ status: 'downloaded', availableVersion: info.version, percent: 100, lastCheckedAt: this.now() });
    });
    updater.on('error', (error) => this.fail(error));
    this.updater = updater;
    return updater;
  }

  private fail(error: Error): void {
    this.deps.log?.('warn', 'update check failed', { error: error.message });
    this.set({ status: 'error', message: friendlyError(error), lastCheckedAt: this.now() });
  }

  private set(patch: Partial<UpdateState>): void {
    const next: UpdateState = { ...this.state, ...patch };
    // Messages belong to error and disabled states only.
    if (patch.status && patch.status !== 'error' && patch.status !== 'disabled' && patch.message === undefined) {
      delete next.message;
    }
    this.state = next;
    for (const listener of this.listeners) {
      listener();
    }
  }
}
