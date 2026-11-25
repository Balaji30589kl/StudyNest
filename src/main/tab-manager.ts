import { BrowserView, BrowserWindow, Event as ElectronEvent, Input, session, WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import {
  BROWSER_CHROME_HEIGHT,
  BlockedNavigationInfo,
  BrowserStateSnapshot,
  BrowserTabState,
  IPC_CHANNELS,
  PageSnapshot
} from '../shared/ipc.js';
import { LANDING_PAGE_URL } from '../shared/landing-page.js';
import { isSafeNavigationUrl, normalizeNavigationInput } from '../shared/url.js';
import { buildErrorPageUrl, shouldShowErrorPage } from './error-page.js';
import { GuardDecision, NavigationGuard, parseInterstitial } from './navigation-guard.js';

type TabRecord = {
  id: string;
  view: BrowserView;
  title: string;
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  blocked: BlockedNavigationInfo | null;
  crashCount: number;
  /** URL being checked by the guard before it may render. */
  checkingUrl: string | null;
  /** Set right after a check finishes so a repeated "defer" cannot loop. */
  lastCheckedUrl: string | null;
};

export type LoadedPage = {
  tabId: string;
  url: string;
  webContents: WebContents;
};

type PageLoadedListener = (page: LoadedPage) => void;
type TabCrashedListener = (event: { tabId: string; reason: string; reloaded: boolean }) => void;
type TabInputListener = (event: ElectronEvent, input: Input) => void;

const MAX_CLOSED_TABS = 10;
const ZOOM_STEP = 0.5;
const MAX_ZOOM_LEVEL = 4;
const MIN_ZOOM_LEVEL = -3;

/** A crashed tab is reloaded automatically at most this many times. */
const MAX_AUTO_RELOADS = 2;

const MAX_CONTENT_INSET_RIGHT = 520;
const MIN_CONTENT_WIDTH = 480;

function isWebUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export class TabManager {
  private readonly tabs = new Map<string, TabRecord>();
  private activeTabId: string | null = null;
  private chromeHeight = BROWSER_CHROME_HEIGHT;
  private contentInsetRight = 0;
  private pageViewHidden = false;
  private guard: NavigationGuard | null = null;
  private readonly pageLoadedListeners = new Set<PageLoadedListener>();
  private readonly tabCrashedListeners = new Set<TabCrashedListener>();
  private readonly tabInputListeners = new Set<TabInputListener>();
  private readonly closedTabUrls: string[] = [];

  constructor(private readonly window: BrowserWindow) {
    this.installRequestFilter();
  }

  /** Lets a higher layer veto navigations. The shell works without one. */
  setNavigationGuard(guard: NavigationGuard | null): void {
    this.guard = guard;
    this.revalidateTabs();
  }

  /** Notifies observers when a normal web page (not an interstitial) finishes loading. */
  onPageLoaded(listener: PageLoadedListener): () => void {
    this.pageLoadedListeners.add(listener);
    return () => this.pageLoadedListeners.delete(listener);
  }

  /** Key events from inside web pages, so browser shortcuts work while a page has focus. */
  onTabInput(listener: TabInputListener): () => void {
    this.tabInputListeners.add(listener);
    return () => this.tabInputListeners.delete(listener);
  }

  /** Moves the active tab by `delta`, wrapping around. */
  cycleTab(delta: number): BrowserStateSnapshot {
    const ids = Array.from(this.tabs.keys());
    if (ids.length > 1 && this.activeTabId) {
      const index = ids.indexOf(this.activeTabId);
      this.activateTab(ids[(index + delta + ids.length) % ids.length]!);
    }
    return this.getSnapshot();
  }

  selectTabAt(index: number): BrowserStateSnapshot {
    const ids = Array.from(this.tabs.keys());
    const id = index < 0 ? ids.at(-1) : ids[index];
    if (id) {
      this.activateTab(id);
    }
    return this.getSnapshot();
  }

  reopenClosedTab(): BrowserStateSnapshot {
    const url = this.closedTabUrls.pop();
    return url ? this.createTab(url, true) : this.getSnapshot();
  }

  hardReload(tabId = this.activeTabId ?? undefined): BrowserStateSnapshot {
    this.getTab(tabId)?.view.webContents.reloadIgnoringCache();
    return this.getSnapshot();
  }

  /** Changes page zoom by `steps` (0 resets). */
  zoom(steps: number, tabId = this.activeTabId ?? undefined): void {
    const webContents = this.getTab(tabId)?.view.webContents;
    if (!webContents || webContents.isDestroyed()) {
      return;
    }
    const next = steps === 0 ? 0 : webContents.getZoomLevel() + steps * ZOOM_STEP;
    webContents.setZoomLevel(Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, next)));
  }

  onTabCrashed(listener: TabCrashedListener): () => void {
    this.tabCrashedListeners.add(listener);
    return () => this.tabCrashedListeners.delete(listener);
  }

  createTab(inputUrl = LANDING_PAGE_URL, activate = true): BrowserStateSnapshot {
    const url = this.normalizeTabUrl(inputUrl);
    const id = randomUUID();
    const view = new BrowserView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false
      }
    });

    const tab: TabRecord = {
      id,
      view,
      title: 'New tab',
      url,
      canGoBack: false,
      canGoForward: false,
      isLoading: true,
      blocked: null,
      crashCount: 0,
      checkingUrl: null,
      lastCheckedUrl: null
    };

    this.attachBrowserViewEvents(tab);
    this.tabs.set(id, tab);

    if (activate || this.activeTabId === null) {
      this.activateTab(id);
    } else {
      this.load(tab, url);
    }

    if (this.activeTabId === id) {
      this.resizeActiveView();
    }

    return this.getSnapshot();
  }

  layoutActiveTab(): void {
    this.resizeActiveView();
  }

  setChromeHeight(height: number): void {
    this.chromeHeight = Math.max(BROWSER_CHROME_HEIGHT, Math.floor(height));
    this.resizeActiveView();
  }

  /** Reserves space on the right of the page for a renderer side panel. */
  setContentInsetRight(width: number): void {
    const numeric = Number.isFinite(width) ? Math.floor(width) : 0;
    this.contentInsetRight = Math.min(MAX_CONTENT_INSET_RIGHT, Math.max(0, numeric));
    this.resizeActiveView();
  }

  /** Captures the active page so the renderer can show it while the live view is hidden. */
  async capturePageSnapshot(): Promise<PageSnapshot | null> {
    const tab = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
    if (!tab || tab.view.webContents.isDestroyed()) {
      return null;
    }
    try {
      const image = await tab.view.webContents.capturePage();
      if (image.isEmpty()) {
        return null;
      }
      return { dataUrl: `data:image/jpeg;base64,${image.toJPEG(85).toString('base64')}`, bounds: tab.view.getBounds() };
    } catch {
      return null;
    }
  }

  /**
   * Temporarily removes the native page view so renderer overlays (the omnibox
   * dropdown) can draw where the page normally sits.
   */
  setPageViewHidden(hidden: boolean): void {
    if (this.pageViewHidden === hidden) {
      return;
    }
    this.pageViewHidden = hidden;
    const tab = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
    if (!tab) {
      return;
    }
    if (hidden) {
      this.detachView(tab);
    } else {
      this.window.setBrowserView(tab.view);
      this.resizeActiveView();
    }
  }

  closeTab(tabId: string): BrowserStateSnapshot {
    const tab = this.tabs.get(tabId);

    if (!tab) {
      return this.getSnapshot();
    }

    const wasActive = this.activeTabId === tabId;
    if (isWebUrl(tab.url)) {
      this.closedTabUrls.push(tab.url);
      if (this.closedTabUrls.length > MAX_CLOSED_TABS) {
        this.closedTabUrls.shift();
      }
    }
    this.detachView(tab);
    this.tabs.delete(tabId);
    if (!tab.view.webContents.isDestroyed()) {
      tab.view.webContents.close();
    }

    if (this.tabs.size === 0) {
      this.activeTabId = null;
      this.createTab(LANDING_PAGE_URL, true);
    } else if (wasActive) {
      const nextTab = this.tabs.values().next().value as TabRecord | undefined;
      if (nextTab) {
        this.activateTab(nextTab.id);
      }
    }

    this.emitState();
    return this.getSnapshot();
  }

  private normalizeTabUrl(inputUrl: string): string {
    if (inputUrl.startsWith('data:text/html;charset=UTF-8,')) {
      return inputUrl;
    }

    return normalizeNavigationInput(inputUrl);
  }

  switchTab(tabId: string): BrowserStateSnapshot {
    if (!this.tabs.has(tabId)) {
      return this.getSnapshot();
    }

    this.activateTab(tabId);
    return this.getSnapshot();
  }

  navigate(inputUrl: string, tabId = this.activeTabId ?? undefined): BrowserStateSnapshot {
    const tab = this.getTab(tabId);
    if (!tab) {
      return this.getSnapshot();
    }

    const url = normalizeNavigationInput(inputUrl);
    if (!isSafeNavigationUrl(url)) {
      return this.getSnapshot();
    }

    tab.url = url;
    tab.isLoading = true;
    tab.checkingUrl = null;
    this.load(tab, url);
    this.emitState();
    return this.getSnapshot();
  }

  goBack(tabId = this.activeTabId ?? undefined): BrowserStateSnapshot {
    const tab = this.getTab(tabId);
    if (tab?.view.webContents.canGoBack()) {
      tab.view.webContents.goBack();
    }
    return this.getSnapshot();
  }

  goForward(tabId = this.activeTabId ?? undefined): BrowserStateSnapshot {
    const tab = this.getTab(tabId);
    if (tab?.view.webContents.canGoForward()) {
      tab.view.webContents.goForward();
    }
    return this.getSnapshot();
  }

  refresh(tabId = this.activeTabId ?? undefined): BrowserStateSnapshot {
    const tab = this.getTab(tabId);
    if (tab) {
      tab.view.webContents.reload();
    }
    return this.getSnapshot();
  }

  getSnapshot(): BrowserStateSnapshot {
    return {
      tabs: Array.from(this.tabs.values()).map((tab) => this.toSnapshotTab(tab)),
      activeTabId: this.activeTabId
    };
  }

  attachActiveTabByIndex(index: number): void {
    const tab = Array.from(this.tabs.values())[index];
    if (tab) {
      this.activateTab(tab.id);
    }
  }

  /**
   * Re-applies the guard to every open tab. Called when the guard's policy
   * changes: newly disallowed pages get an interstitial, and interstitials
   * whose target is now allowed are restored.
   */
  revalidateTabs(): void {
    const guard = this.guard;

    for (const tab of this.tabs.values()) {
      if (tab.view.webContents.isDestroyed()) {
        continue;
      }

      if (tab.checkingUrl) {
        // A check is in flight; its result will be applied when it settles.
        continue;
      }

      if (tab.blocked) {
        if (!guard || guard.isAllowed(tab.blocked.url)) {
          const target = tab.blocked.url;
          tab.blocked = null;
          this.load(tab, target);
        }
        continue;
      }

      // tab.url is what the tab shows or is currently loading; the committed URL can lag
      // behind (for example while a just-unblocked tab is still reloading).
      const targetUrl = isWebUrl(tab.url) ? tab.url : tab.view.webContents.getURL();
      if (guard && isWebUrl(targetUrl) && !guard.isAllowed(targetUrl)) {
        this.applyGuardDecision(tab, this.decide(tab, targetUrl), targetUrl);
      }
    }

    this.emitState();
  }

  private installRequestFilter(): void {
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*'] },
      (details, callback) => {
        if (details.resourceType !== 'mainFrame' || !this.guard || details.webContentsId === undefined) {
          callback({});
          return;
        }

        const tab = this.findTabByWebContentsId(details.webContentsId);
        if (!tab) {
          callback({});
          return;
        }

        const decision = this.decide(tab, details.url);
        if (decision.kind === 'allow') {
          callback({});
          return;
        }

        callback({ cancel: true });
        setImmediate(() => this.applyGuardDecision(tab, decision, details.url));
      }
    );
  }

  /** Asks the guard, turning a repeated "defer" right after a finished check into "allow". */
  private decide(tab: TabRecord, url: string): GuardDecision {
    const decision = this.guard ? this.guard.evaluateNavigation(url, tab.id) : ({ kind: 'allow' } as const);
    if (decision.kind === 'defer' && tab.lastCheckedUrl === url) {
      tab.lastCheckedUrl = null;
      return { kind: 'allow' };
    }
    if (decision.kind !== 'defer') {
      tab.lastCheckedUrl = null;
    }
    return decision;
  }

  private applyGuardDecision(tab: TabRecord, decision: GuardDecision, url: string): void {
    if (!this.tabs.has(tab.id) || tab.view.webContents.isDestroyed()) {
      return;
    }

    switch (decision.kind) {
      case 'allow':
      case 'cancel':
        return;
      case 'redirect':
        tab.url = decision.url;
        this.load(tab, decision.url);
        this.emitState();
        return;
      case 'intercept':
        tab.checkingUrl = null;
        tab.blocked = decision.blocked;
        tab.url = decision.blocked.url;
        tab.title = `Blocked · ${decision.blocked.host}`;
        tab.isLoading = false;
        this.load(tab, decision.interstitialUrl);
        this.emitState();
        return;
      case 'defer':
        // Show "Checking page…" while the guard decides, then try the real URL again.
        tab.checkingUrl = url;
        tab.blocked = null;
        tab.url = url;
        tab.title = 'Checking page…';
        tab.isLoading = true;
        this.load(tab, decision.checkingUrl);
        this.emitState();
        void decision.ready
          .catch(() => undefined)
          .then(() => {
            if (!this.tabs.has(tab.id) || tab.view.webContents.isDestroyed() || tab.checkingUrl !== url) {
              return; // The tab was closed or navigated elsewhere meanwhile.
            }
            tab.checkingUrl = null;
            tab.lastCheckedUrl = url;
            this.load(tab, url);
            this.emitState();
          });
        return;
    }
  }

  private findTabByWebContentsId(webContentsId: number): TabRecord | undefined {
    for (const tab of this.tabs.values()) {
      if (!tab.view.webContents.isDestroyed() && tab.view.webContents.id === webContentsId) {
        return tab;
      }
    }
    return undefined;
  }

  /** loadURL rejects when a navigation is aborted or blocked; that is expected here. */
  private load(tab: TabRecord, url: string): void {
    tab.view.webContents.loadURL(url).catch(() => undefined);
  }

  /**
   * Records the tab URL. Interstitial pages map back to the URL they replaced.
   * Only real commits may clear the blocked state: load-stop events can still
   * report the previous page after a request was cancelled by the guard.
   */
  private commitTabUrl(tab: TabRecord, url: string, isCommit: boolean): void {
    if (!url) {
      return;
    }

    const interstitial = parseInterstitial(url);
    if (interstitial?.kind === 'checking') {
      // The checking screen can commit after the verdict already replaced it,
      // so it must never touch the block state.
      if (!tab.blocked) {
        tab.url = interstitial.target;
      }
      return;
    }
    if (interstitial?.kind === 'error') {
      tab.blocked = null;
      tab.url = interstitial.target;
      return;
    }
    const interstitialTarget = interstitial?.target ?? null;
    if (interstitialTarget) {
      tab.url = interstitialTarget;
      if (isCommit && !tab.blocked) {
        tab.blocked = { url: interstitialTarget, host: hostOf(interstitialTarget), action: 'block', reason: 'blocklisted' };
      }
      return;
    }

    if (tab.blocked && !isCommit) {
      return;
    }

    tab.blocked = null;
    if (isCommit) {
      tab.checkingUrl = null;
    }
    tab.url = url;
  }

  private activateTab(tabId: string): void {
    const nextTab = this.tabs.get(tabId);
    if (!nextTab) {
      return;
    }

    const currentTab = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
    if (currentTab && currentTab.id !== nextTab.id) {
      this.detachView(currentTab);
    }

    if (!this.pageViewHidden) {
      this.window.setBrowserView(nextTab.view);
    }
    this.activeTabId = nextTab.id;
    this.resizeActiveView();

    if (nextTab.view.webContents.getURL().length === 0 || nextTab.view.webContents.getURL() === 'about:blank') {
      this.load(nextTab, nextTab.url);
    }

    this.guard?.onActivePageChanged?.(nextTab.blocked ? null : nextTab.view.webContents.getURL() || null);
    this.emitState();
  }

  private resizeActiveView(): void {
    const activeTab = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
    if (!activeTab) {
      return;
    }

    const contentBounds = this.window.getContentBounds();
    const inset = Math.min(this.contentInsetRight, Math.max(contentBounds.width - MIN_CONTENT_WIDTH, 0));
    activeTab.view.setBounds({
      x: 0,
      y: this.chromeHeight,
      width: Math.max(contentBounds.width - inset, 0),
      height: Math.max(contentBounds.height - this.chromeHeight, 0)
    });
    activeTab.view.setAutoResize({ width: false, height: false });
  }

  private detachView(tab: TabRecord): void {
    try {
      this.window.removeBrowserView(tab.view);
    } catch {
      // The view may already be detached.
    }
  }

  private attachBrowserViewEvents(tab: TabRecord): void {
    const { webContents } = tab.view;

    webContents.on('did-start-loading', () => {
      tab.isLoading = true;
      this.syncNavigationState(tab);
    });

    webContents.on('did-stop-loading', () => {
      tab.isLoading = false;
      if (!tab.blocked) {
        tab.title = webContents.getTitle() || tab.title;
      }
      this.commitTabUrl(tab, webContents.getURL(), false);
      this.syncNavigationState(tab);
    });

    webContents.on('page-title-updated', (_event, title) => {
      if (!tab.blocked) {
        tab.title = title;
      }
      this.emitState();
    });

    webContents.on('did-navigate', (_event, url) => {
      this.commitTabUrl(tab, url, true);
      this.syncNavigationState(tab);
      this.afterTopLevelNavigation(tab, url);
    });

    webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame === false) {
        return;
      }
      this.commitTabUrl(tab, url, false);
      this.syncNavigationState(tab);
      // Single-page sites (YouTube) switch videos without a new request; check those too.
      if (this.guard && isWebUrl(url) && !tab.blocked && !tab.checkingUrl) {
        const decision = this.decide(tab, url);
        if (decision.kind !== 'allow') {
          this.applyGuardDecision(tab, decision, url);
        }
      }
    });

    webContents.setWindowOpenHandler(({ url }) => {
      this.createTab(url, true);
      return { action: 'deny' };
    });

    webContents.on('did-finish-load', () => {
      const url = webContents.getURL();
      if (tab.blocked || !isWebUrl(url)) {
        return;
      }
      for (const listener of this.pageLoadedListeners) {
        listener({ tabId: tab.id, url, webContents });
      }
    });

    webContents.on('before-input-event', (event, input) => {
      for (const listener of this.tabInputListeners) {
        listener(event, input);
      }
    });

    webContents.on('render-process-gone', (_event, details) => {
      tab.isLoading = false;
      if (details.reason === 'clean-exit' || !this.tabs.has(tab.id)) {
        return;
      }
      tab.crashCount += 1;
      const reload = tab.crashCount <= MAX_AUTO_RELOADS;
      tab.title = reload ? 'Reloading after crash…' : 'Page crashed. Press Refresh to retry.';
      for (const listener of this.tabCrashedListeners) {
        listener({ tabId: tab.id, reason: details.reason, reloaded: reload });
      }
      if (reload) {
        webContents.reload();
      }
      this.emitState();
    });

    webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      tab.isLoading = false;
      if (shouldShowErrorPage(errorCode, isMainFrame) && isWebUrl(validatedURL) && !tab.blocked) {
        // Show an explanation instead of a blank or stale page.
        tab.url = validatedURL;
        this.load(tab, buildErrorPageUrl(validatedURL, errorCode, errorDescription));
      }
      this.syncNavigationState(tab);
    });
  }

  /**
   * Backstop for navigations that commit without a fresh network request
   * (for example history restores), then reports the page to the guard.
   */
  private afterTopLevelNavigation(tab: TabRecord, url: string): void {
    const guard = this.guard;
    const isActiveTab = this.activeTabId === tab.id;

    if (!guard) {
      return;
    }

    if (!isWebUrl(url)) {
      if (isActiveTab) {
        guard.onActivePageChanged?.(null);
      }
      return;
    }

    if (!guard.isAllowed(url)) {
      const decision = this.decide(tab, url);
      if (decision.kind !== 'allow') {
        this.applyGuardDecision(tab, decision, url);
        return;
      }
    }

    guard.onPageCommitted?.({ tabId: tab.id, url, title: tab.view.webContents.getTitle(), isActiveTab });
  }

  private syncNavigationState(tab: TabRecord): void {
    if (tab.view.webContents.isDestroyed()) {
      return;
    }
    tab.canGoBack = tab.view.webContents.canGoBack();
    tab.canGoForward = tab.view.webContents.canGoForward();
    this.emitState();
  }

  private toSnapshotTab(tab: TabRecord): BrowserTabState {
    return {
      id: tab.id,
      title: tab.title || 'New tab',
      url: tab.url,
      canGoBack: tab.canGoBack,
      canGoForward: tab.canGoForward,
      isLoading: tab.isLoading || tab.checkingUrl !== null,
      blocked: tab.blocked ? { ...tab.blocked } : null,
      checking: tab.checkingUrl !== null
    };
  }

  private getTab(tabId?: string): TabRecord | undefined {
    const resolvedTabId = tabId ?? this.activeTabId ?? undefined;
    if (!resolvedTabId) {
      return undefined;
    }

    return this.tabs.get(resolvedTabId);
  }

  private emitState(): void {
    if (this.window.isDestroyed()) {
      return;
    }
    this.window.webContents.send(IPC_CHANNELS.STATE_CHANGED, this.getSnapshot());
  }
}
