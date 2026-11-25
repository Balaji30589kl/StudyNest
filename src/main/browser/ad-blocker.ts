import { ElectronBlocker } from '@ghostery/adblocker-electron';
import { ipcMain, IpcMainInvokeEvent, Session } from 'electron';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { AdBlockState } from '../../shared/ipc.js';
import type { SubresourceFilter } from '../tab-manager.js';

const COSMETIC_CHANNEL = '@ghostery/adblocker/inject-cosmetic-filters';
const MUTATION_CHANNEL = '@ghostery/adblocker/is-mutation-observer-enabled';
const RETRY_MS = 5 * 60 * 1000;

export type AdBlockerDeps = {
  session: Session;
  /** Serialized filter engine, so later starts work offline. */
  cacheFile: string;
  fetchImpl: (url: string) => Promise<{ text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer>; json(): Promise<unknown> }>;
  /** Whether blocking applies on a page (setting on, site not excepted). */
  isActiveFor: (pageUrl: string | null) => boolean;
  /** The browser chrome, which never gets cosmetic filters. */
  isChrome: (webContentsId: number) => boolean;
  log: (level: 'info' | 'warn', message: string, data?: Record<string, unknown>) => void;
};

/**
 * Ad and tracker blocking with the uBlock Origin / EasyList filter lists
 * (Ghostery's engine). Network requests are filtered through the tab manager's
 * single request listener, because Electron allows only one per session, and
 * page elements are hidden by a preload that asks for cosmetic filters.
 */
export class AdBlocker {
  private engine: ElectronBlocker | null = null;
  private state: AdBlockState = { ready: false, error: null, totalBlocked: 0 };
  private readonly listeners = new Set<(state: AdBlockState) => void>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: AdBlockerDeps) {}

  onChange(listener: (state: AdBlockState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): AdBlockState {
    return { ...this.state };
  }

  /** Request filter for TabManager.setSubresourceFilter. */
  readonly filter: SubresourceFilter = (details, pageUrl, callback) => {
    const engine = this.engine;
    if (!engine || !this.deps.isActiveFor(pageUrl)) {
      callback({});
      return;
    }
    try {
      engine.onBeforeRequest(details, (response) => {
        if (response.cancel || response.redirectURL) {
          this.state.totalBlocked += 1;
        }
        // The lists redirect some trackers to harmless stand-in scripts as data: URLs.
        // Redirecting to data: URLs crashes Electron 31's main process, so those are blocked instead.
        callback(response.redirectURL ? { cancel: true } : response);
      });
    } catch {
      callback({});
    }
  };

  async start(): Promise<void> {
    try {
      this.engine = await ElectronBlocker.fromPrebuiltAdsAndTracking(this.deps.fetchImpl, {
        path: this.deps.cacheFile,
        read: async (file) => new Uint8Array(await fs.readFile(file)),
        write: (file, buffer) => fs.writeFile(file, buffer)
      });
      this.installCosmeticFiltering();
      this.state = { ...this.state, ready: true, error: null };
      this.deps.log('info', 'ad blocker ready');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state = { ...this.state, ready: false, error: 'Could not download the ad-block lists. Retrying in a few minutes.' };
      this.deps.log('warn', 'ad blocker lists unavailable', { error: message });
      this.retryTimer = setTimeout(() => void this.start(), RETRY_MS);
    }
    this.emit();
  }

  stop(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  private installCosmeticFiltering(): void {
    const preload = createRequire(import.meta.url).resolve('@ghostery/adblocker-electron-preload');
    const session = this.deps.session;
    if (!session.getPreloads().includes(preload)) {
      session.setPreloads([...session.getPreloads(), preload]);
    }
    ipcMain.removeHandler(COSMETIC_CHANNEL);
    ipcMain.removeHandler(MUTATION_CHANNEL);
    ipcMain.handle(COSMETIC_CHANNEL, (event: IpcMainInvokeEvent, url: unknown, message: unknown) => {
      const engine = this.engine;
      if (!engine || typeof url !== 'string' || this.deps.isChrome(event.sender.id) || !this.deps.isActiveFor(url)) {
        return undefined;
      }
      // Hide ad elements with CSS only. The filter lists' scriptlets (code injected into
      // pages) break players such as YouTube's (black video) and can crash Electron 31,
      // so they are never run: the library gets an event that can insert CSS but not scripts.
      const cssOnly = {
        frameId: event.frameId,
        processId: event.processId,
        sender: {
          insertCSS: (css: string, options?: Electron.InsertCSSOptions) => event.sender.insertCSS(css, options).catch(() => ''),
          executeJavaScript: () => Promise.resolve(undefined)
        }
      } as unknown as IpcMainInvokeEvent;
      return engine.onInjectCosmeticFilters(cssOnly, url, message as Parameters<ElectronBlocker['onInjectCosmeticFilters']>[2]);
    });
    ipcMain.handle(MUTATION_CHANNEL, () => this.engine?.config.enableMutationObserver ?? false);
  }

  private emit(): void {
    const snapshot = this.getState();
    for (const listener of this.listeners) listener(snapshot);
  }
}
