import {
  BrowserView,
  BrowserWindow,
  ContextMenuParams,
  Event as ElectronEvent,
  Input,
  OnBeforeRequestListenerDetails,
  CallbackResponse,
  session,
  WebContents
} from 'electron';
import { randomUUID } from 'node:crypto';
import {
  BROWSER_CHROME_HEIGHT,
  BlockedNavigationInfo,
  BrowserStateSnapshot,
  BrowserTabState,
  FindResult,
  IPC_CHANNELS,
  PageSnapshot
} from '../shared/ipc.js';
import { internalPageOf, internalPageTitle, isInternalUrl, NEW_TAB_URL } from '../shared/internal-pages.js';
import type { SearchEngineId } from '../shared/search-engines.js';
import { isSafeNavigationUrl, normalizeNavigationInput } from '../shared/url.js';
import { buildErrorPageUrl, shouldShowErrorPage } from './error-page.js';
import { GuardDecision, NavigationGuard, parseInterstitial } from './navigation-guard.js';

type TabRecord = {
  id: string;
  view: BrowserView;
  title: string;
  /** What the tab shows: a web URL, or a built-in page such as studynest://history. */
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
  favicon: string | null;
  faviconHost: string | null;
  audible: boolean;
  muted: boolean;
  pinned: boolean;
  zoomPercent: number;
  blockedAds: number;
  /** False for restored tabs that have not been opened yet (they load on first activation). */
  loaded: boolean;
  /** The tab a link was opened from, so several links line up after it in order. */
  openerId: string | null;
  /** The built-in page this tab's web browsing started from (Back from the first page returns to it). */
  backToInternal: string | null;
  /** On a built-in page opened over a web page: Back returns to that page. */
  internalFromWeb: boolean;
  /** On a built-in page reached with Back: Forward returns to the web page. */
  forwardToWeb: boolean;
  /** Latest find-in-page request; results of older requests are ignored. */
  findRequestId: number;
};

export type LoadedPage = {
  tabId: string;
  url: string;
  webContents: WebContents;
};

export type CommittedNavigation = { tabId: string; url: string; title: string };

export type CreateTabOptions = {
  activate?: boolean;
  pinned?: boolean;
  /** Don't load until the tab is first shown (session restore). */
  lazy?: boolean;
  /** Title to show before a lazy tab loads. */
  title?: string;
  /** Open right after this tab instead of at the end (links opened from a page). */
  afterTabId?: string;
};

/**
 * Decides what happens to a sub-resource request (images, scripts, frames).
 * Used by the ad blocker. Calls `callback` exactly once.
 */
export type SubresourceFilter = (
  details: OnBeforeRequestListenerDetails,
  pageUrl: string | null,
  callback: (response: CallbackResponse) => void
) => void;

type PageLoadedListener = (page: LoadedPage) => void;
type TabCrashedListener = (event: { tabId: string; reason: string; reloaded: boolean }) => void;
type TabInputListener = (event: ElectronEvent, input: Input) => void;
type NavigationListener = (navigation: CommittedNavigation) => void;
type ContextMenuListener = (tabId: string, params: ContextMenuParams, webContents: WebContents) => void;
type StateListener = (snapshot: BrowserStateSnapshot) => void;

const MAX_CLOSED_TABS = 25;
const ZOOM_STEP = 0.5;
const MAX_ZOOM_LEVEL = 4;
const MIN_ZOOM_LEVEL = -3;

/** A crashed tab is reloaded automatically at most this many times. */
const MAX_AUTO_RELOADS = 2;

const MIN_CHROME_HEIGHT = 40;
const MAX_CHROME_HEIGHT = 400;
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

/** True when the tab's page holds a real page (so "Back" from a built-in page can return to it). */
function hasWebPage(tab: TabRecord): boolean {
  return !tab.view.webContents.isDestroyed() && isWebUrl(tab.view.webContents.getURL() || '');
}

/**
 * True on the first real page of the tab's history: the entry before it is the
 * blank placeholder document (or there is none).
 */
function isAtSessionStart(tab: TabRecord): boolean {
  const contents = tab.view.webContents;
  if (contents.isDestroyed()) return true;
  const history = contents.navigationHistory;
  const index = history.getActiveIndex();
  if (index <= 0) return true;
  const previous = history.getEntryAtIndex(index - 1)?.url ?? '';
  return previous === '' || previous === 'about:blank';
}

export class TabManager {
  private readonly tabs = new Map<string, TabRecord>();
  /** Tab order as shown in the tab strip; pinned tabs always come first. */
  private order: string[] = [];
  private activeTabId: string | null = null;
  private chromeHeight = BROWSER_CHROME_HEIGHT;
  private contentInsetRight = 0;
  private pageViewHidden = false;
  private guard: NavigationGuard | null = null;
  private subresourceFilter: SubresourceFilter | null = null;
  private searchEngine: () => SearchEngineId = () => 'duckduckgo';
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pageLoadedListeners = new Set<PageLoadedListener>();
  private readonly tabCrashedListeners = new Set<TabCrashedListener>();
  private readonly tabInputListeners = new Set<TabInputListener>();
  private readonly navigationListeners = new Set<NavigationListener>();
  private readonly titleListeners = new Set<NavigationListener>();
  private readonly contextMenuListeners = new Set<ContextMenuListener>();
  private readonly stateListeners = new Set<StateListener>();
  private readonly closedTabUrls: string[] = [];

  constructor(private readonly window: BrowserWindow) {
    this.installRequestFilter();
  }

  /** Lets a higher layer veto navigations. The shell works without one. */
  setNavigationGuard(guard: NavigationGuard | null): void {
    this.guard = guard;
    this.revalidateTabs();
  }

  /** Lets the ad blocker decide sub-resource requests. Top-level pages always go through the guard. */
  setSubresourceFilter(filter: SubresourceFilter | null): void {
    this.subresourceFilter = filter;
  }

  /** Where typed searches go. */
  setSearchEngineProvider(provider: () => SearchEngineId): void {
    this.searchEngine = provider;
  }

  /** Notifies observers when a normal web page (not an interstitial) finishes loading. */
  onPageLoaded(listener: PageLoadedListener): () => void {
    this.pageLoadedListeners.add(listener);
    return () => this.pageLoadedListeners.delete(listener);
  }

  /** A top-level web page committed (for browsing history). */
  onNavigationCommitted(listener: NavigationListener): () => void {
    this.navigationListeners.add(listener);
    return () => this.navigationListeners.delete(listener);
  }

  /** A page's title changed after it committed. */
  onTitleChanged(listener: NavigationListener): () => void {
    this.titleListeners.add(listener);
    return () => this.titleListeners.delete(listener);
  }

  /** Right-click inside a page. */
  onContextMenu(listener: ContextMenuListener): () => void {
    this.contextMenuListeners.add(listener);
    return () => this.contextMenuListeners.delete(listener);
  }

  /** Any change to the tabs (used to save the session). */
  onStateChanged(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /** Key events from inside web pages, so browser shortcuts work while a page has focus. */
  onTabInput(listener: TabInputListener): () => void {
    this.tabInputListeners.add(listener);
    return () => this.tabInputListeners.delete(listener);
  }

  onTabCrashed(listener: TabCrashedListener): () => void {
    this.tabCrashedListeners.add(listener);
    return () => this.tabCrashedListeners.delete(listener);
  }

  /** Moves the active tab by `delta`, wrapping around. */
  cycleTab(delta: number): BrowserStateSnapshot {
    const ids = this.order;
    if (ids.length > 1 && this.activeTabId) {
      const index = ids.indexOf(this.activeTabId);
      this.activateTab(ids[(index + delta + ids.length) % ids.length]!);
    }
    return this.getSnapshot();
  }

  selectTabAt(index: number): BrowserStateSnapshot {
    const id = index < 0 ? this.order.at(-1) : this.order[index];
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
    const tab = this.getTab(tabId);
    if (tab && !isInternalUrl(tab.url)) {
      tab.view.webContents.reloadIgnoringCache();
    }
    return this.getSnapshot();
  }

  /** Changes page zoom by `steps` (0 resets). */
  zoom(steps: number, tabId = this.activeTabId ?? undefined): void {
    const tab = this.getTab(tabId);
    const webContents = tab?.view.webContents;
    if (!tab || !webContents || webContents.isDestroyed() || isInternalUrl(tab.url)) {
      return;
    }
    const next = steps === 0 ? 0 : webContents.getZoomLevel() + steps * ZOOM_STEP;
    webContents.setZoomLevel(Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, next)));
    tab.zoomPercent = Math.round(webContents.getZoomFactor() * 100);
    this.emitState();
  }

  createTab(inputUrl: string = NEW_TAB_URL, activateOrOptions: boolean | CreateTabOptions = true): BrowserStateSnapshot {
    const options: CreateTabOptions = typeof activateOrOptions === 'boolean' ? { activate: activateOrOptions } : activateOrOptions;
    const activate = options.activate ?? true;
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
    view.setBackgroundColor('#ffffff');

    const page = internalPageOf(url);
    const tab: TabRecord = {
      id,
      view,
      title: page ? internalPageTitle(page) : options.title || 'New tab',
      url,
      canGoBack: false,
      canGoForward: false,
      isLoading: !page && !options.lazy,
      blocked: null,
      crashCount: 0,
      checkingUrl: null,
      lastCheckedUrl: null,
      favicon: null,
      faviconHost: null,
      audible: false,
      muted: false,
      pinned: options.pinned === true,
      zoomPercent: 100,
      blockedAds: 0,
      loaded: false,
      openerId: options.afterTabId ?? null,
      backToInternal: null,
      internalFromWeb: false,
      forwardToWeb: false,
      findRequestId: -1
    };

    this.attachBrowserViewEvents(tab);
    if (page || options.lazy) {
      // Built-in pages are drawn by the chrome, and restored tabs load on first view, but
      // each tab's web contents still needs a document: one that never loaded has no
      // renderer, which stalls tools that attach to every page (dev tools, test drivers).
      view.webContents.loadURL('about:blank').catch(() => undefined);
    }
    this.tabs.set(id, tab);
    this.insertInOrder(tab, options.afterTabId);

    if (activate || this.activeTabId === null) {
      this.activateTab(id);
    } else if (!options.lazy) {
      this.ensureLoaded(tab);
    }

    this.emitState();
    return this.getSnapshot();
  }

  layoutActiveTab(): void {
    this.resizeActiveView();
  }

  setChromeHeight(height: number): void {
    const numeric = Number.isFinite(height) ? Math.ceil(height) : BROWSER_CHROME_HEIGHT;
    this.chromeHeight = Math.min(MAX_CHROME_HEIGHT, Math.max(MIN_CHROME_HEIGHT, numeric));
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
    if (!tab || tab.view.webContents.isDestroyed() || isInternalUrl(tab.url)) {
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
    if (hidden || isInternalUrl(tab.url)) {
      this.detachView(tab);
    } else {
      this.attachView(tab);
    }
  }

  closeTab(tabId: string): BrowserStateSnapshot {
    const tab = this.tabs.get(tabId);

    if (!tab) {
      return this.getSnapshot();
    }

    const wasActive = this.activeTabId === tabId;
    const index = this.order.indexOf(tabId);
    const reopenUrl = tab.blocked?.url ?? tab.url;
    if (isWebUrl(reopenUrl) || (isInternalUrl(reopenUrl) && internalPageOf(reopenUrl) !== 'newtab')) {
      this.closedTabUrls.push(reopenUrl);
      if (this.closedTabUrls.length > MAX_CLOSED_TABS) {
        this.closedTabUrls.shift();
      }
    }
    this.detachView(tab);
    this.tabs.delete(tabId);
    this.order = this.order.filter((id) => id !== tabId);
    if (!tab.view.webContents.isDestroyed()) {
      tab.view.webContents.close();
    }

    if (this.tabs.size === 0) {
      this.activeTabId = null;
      this.createTab(NEW_TAB_URL, true);
    } else if (wasActive) {
      // Like other browsers: activate the tab to the right, or the new last tab.
      const nextId = this.order[Math.min(index, this.order.length - 1)];
      if (nextId) {
        this.activateTab(nextId);
      }
    }

    this.emitState();
    return this.getSnapshot();
  }

  closeOtherTabs(tabId: string): BrowserStateSnapshot {
    for (const id of [...this.order]) {
      const tab = this.tabs.get(id);
      if (id !== tabId && tab && !tab.pinned) this.closeTab(id);
    }
    this.activateTab(tabId);
    return this.getSnapshot();
  }

  closeTabsToRight(tabId: string): BrowserStateSnapshot {
    const index = this.order.indexOf(tabId);
    for (const id of this.order.slice(index + 1)) {
      if (!this.tabs.get(id)?.pinned) this.closeTab(id);
    }
    return this.getSnapshot();
  }

  duplicateTab(tabId: string): BrowserStateSnapshot {
    const tab = this.tabs.get(tabId);
    if (!tab) return this.getSnapshot();
    return this.createTab(tab.blocked?.url ?? tab.url, { activate: true, afterTabId: tabId });
  }

  setPinned(tabId: string, pinned: boolean): BrowserStateSnapshot {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.pinned === pinned) return this.getSnapshot();
    tab.pinned = pinned;
    // Pinned tabs live at the start of the strip: the tab moves to the boundary
    // between pinned and unpinned tabs (end of the pinned group, or start of the rest).
    this.order = this.order.filter((id) => id !== tabId);
    const firstUnpinned = this.order.findIndex((id) => !this.tabs.get(id)?.pinned);
    this.order.splice(firstUnpinned === -1 ? this.order.length : firstUnpinned, 0, tabId);
    this.emitState();
    return this.getSnapshot();
  }

  setMuted(tabId: string, muted: boolean): BrowserStateSnapshot {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.view.webContents.isDestroyed()) return this.getSnapshot();
    tab.view.webContents.setAudioMuted(muted);
    tab.muted = muted;
    this.emitState();
    return this.getSnapshot();
  }

  /** Moves a tab to `index`, keeping pinned and unpinned tabs in their own groups. */
  moveTab(tabId: string, index: number): BrowserStateSnapshot {
    const tab = this.tabs.get(tabId);
    if (!tab) return this.getSnapshot();
    const rest = this.order.filter((id) => id !== tabId);
    const pinnedCount = rest.filter((id) => this.tabs.get(id)?.pinned).length;
    const min = tab.pinned ? 0 : pinnedCount;
    const max = tab.pinned ? pinnedCount : rest.length;
    const target = Math.min(Math.max(Math.round(index), min), max);
    rest.splice(target, 0, tabId);
    this.order = rest;
    this.emitState();
    return this.getSnapshot();
  }

  private normalizeTabUrl(inputUrl: string): string {
    if (inputUrl.startsWith('data:text/html;charset=UTF-8,')) {
      return inputUrl;
    }

    return normalizeNavigationInput(inputUrl, this.searchEngine());
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

    const url = normalizeNavigationInput(inputUrl, this.searchEngine());
    if (!isSafeNavigationUrl(url)) {
      return this.getSnapshot();
    }

    tab.checkingUrl = null;
    tab.blocked = null;
    if (isInternalUrl(url)) {
      tab.internalFromWeb = isInternalUrl(tab.url) ? tab.internalFromWeb : hasWebPage(tab);
      tab.forwardToWeb = false;
      this.showInternalPage(tab, url);
    } else {
      if (isInternalUrl(tab.url)) tab.backToInternal = tab.url;
      tab.internalFromWeb = false;
      tab.forwardToWeb = false;
      tab.url = url;
      tab.isLoading = true;
      tab.loaded = true;
      if (this.activeTabId === tab.id) this.attachView(tab);
      this.load(tab, url);
    }
    this.syncNavigationState(tab);
    return this.getSnapshot();
  }

  goBack(tabId = this.activeTabId ?? undefined): BrowserStateSnapshot {
    const tab = this.getTab(tabId);
    if (!tab) return this.getSnapshot();
    if (isInternalUrl(tab.url)) {
      // A built-in page opened over a web page: Back returns to that page.
      if (tab.internalFromWeb && hasWebPage(tab)) {
        tab.internalFromWeb = false;
        this.returnToWebPage(tab);
      }
      return this.getSnapshot();
    }
    if (isAtSessionStart(tab)) {
      // The first page after a built-in page (or a restored tab): Back returns to the
      // built-in page, never to the blank placeholder document underneath.
      if (tab.backToInternal) {
        const target = tab.backToInternal;
        this.showInternalPage(tab, target);
        tab.forwardToWeb = true;
        this.syncNavigationState(tab);
      }
      return this.getSnapshot();
    }
    if (tab.view.webContents.canGoBack()) {
      tab.view.webContents.goBack();
    }
    return this.getSnapshot();
  }

  goForward(tabId = this.activeTabId ?? undefined): BrowserStateSnapshot {
    const tab = this.getTab(tabId);
    if (!tab) return this.getSnapshot();
    if (isInternalUrl(tab.url)) {
      if (tab.forwardToWeb && hasWebPage(tab)) {
        tab.forwardToWeb = false;
        this.returnToWebPage(tab);
      }
      return this.getSnapshot();
    }
    if (tab.view.webContents.canGoForward()) {
      tab.view.webContents.goForward();
    }
    return this.getSnapshot();
  }

  /** Shows the web page still loaded in the tab after a built-in page covered it. */
  private returnToWebPage(tab: TabRecord): void {
    tab.url = tab.view.webContents.getURL();
    tab.title = tab.view.webContents.getTitle() || tab.title;
    tab.isLoading = false;
    if (this.activeTabId === tab.id) {
      this.attachView(tab);
      this.guard?.onActivePageChanged?.(tab.url);
    }
    this.syncNavigationState(tab);
  }

  refresh(tabId = this.activeTabId ?? undefined): BrowserStateSnapshot {
    const tab = this.getTab(tabId);
    if (!tab) return this.getSnapshot();
    if (isInternalUrl(tab.url)) {
      this.emitState();
    } else if (tab.blocked) {
      // Retry the blocked address itself (it is checked again).
      this.navigate(tab.blocked.url, tab.id);
    } else {
      tab.view.webContents.reload();
    }
    return this.getSnapshot();
  }

  stop(tabId = this.activeTabId ?? undefined): void {
    const tab = this.getTab(tabId);
    if (tab && !tab.view.webContents.isDestroyed()) {
      tab.view.webContents.stop();
      tab.isLoading = false;
      this.emitState();
    }
  }

  /** Searches the active page; results arrive through FIND_RESULT. */
  find(text: string, options: { forward: boolean; findNext: boolean }): void {
    const tab = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
    if (!tab || isInternalUrl(tab.url) || tab.view.webContents.isDestroyed()) return;
    if (!text) {
      tab.view.webContents.stopFindInPage('clearSelection');
      this.sendFindResult({ tabId: tab.id, activeMatch: 0, matches: 0, finalUpdate: true });
      return;
    }
    // Electron's findNext means "start a new search"; ours means "step to the next match".
    tab.findRequestId = tab.view.webContents.findInPage(text, { forward: options.forward, findNext: !options.findNext, matchCase: false });
  }

  stopFind(): void {
    for (const tab of this.tabs.values()) {
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.stopFindInPage('keepSelection');
    }
  }

  print(): void {
    const tab = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
    if (tab && !isInternalUrl(tab.url) && !tab.view.webContents.isDestroyed()) {
      tab.view.webContents.print({ printBackground: true }, () => undefined);
    }
  }

  getActiveWebContents(): WebContents | null {
    const tab = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
    return tab && !tab.view.webContents.isDestroyed() && !isInternalUrl(tab.url) ? tab.view.webContents : null;
  }

  /** The active tab's page address and title (for bookmarking). */
  getActivePage(): { url: string; title: string } | null {
    const tab = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
    if (!tab) return null;
    return { url: tab.blocked?.url ?? tab.url, title: tab.title };
  }

  getSnapshot(): BrowserStateSnapshot {
    return {
      tabs: this.order.map((id) => this.toSnapshotTab(this.tabs.get(id)!)),
      activeTabId: this.activeTabId
    };
  }

  /** Tabs for session restore: blocked tabs are saved as the page they tried to open. */
  getSessionTabs(): { tabs: Array<{ url: string; title: string; pinned: boolean }>; activeIndex: number } {
    const tabs = this.order.map((id) => {
      const tab = this.tabs.get(id)!;
      return { url: tab.blocked?.url ?? tab.checkingUrl ?? tab.url, title: tab.title, pinned: tab.pinned };
    });
    return { tabs, activeIndex: Math.max(0, this.activeTabId ? this.order.indexOf(this.activeTabId) : 0) };
  }

  attachActiveTabByIndex(index: number): void {
    const id = this.order[index];
    if (id) {
      this.activateTab(id);
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
      if (tab.view.webContents.isDestroyed() || isInternalUrl(tab.url) || !tab.loaded) {
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
        const tab = details.webContentsId === undefined ? undefined : this.findTabByWebContentsId(details.webContentsId);

        if (details.resourceType !== 'mainFrame') {
          if (!tab || !this.subresourceFilter) {
            callback({});
            return;
          }
          // Electron allows one listener per event, so the ad blocker runs inside this one.
          this.subresourceFilter(details, isWebUrl(tab.url) ? tab.url : null, (response) => {
            if (response.cancel || response.redirectURL) {
              tab.blockedAds += 1;
              this.scheduleEmit();
            }
            callback(response);
          });
          return;
        }

        if (!this.guard || !tab) {
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
    tab.loaded = true;
    tab.view.webContents.loadURL(url).catch(() => undefined);
  }

  /** Loads a lazily restored tab the first time it is needed. */
  private ensureLoaded(tab: TabRecord): void {
    if (tab.loaded || isInternalUrl(tab.url)) return;
    const current = tab.view.webContents.getURL();
    if (current.length === 0 || current === 'about:blank') {
      tab.isLoading = true;
      this.load(tab, tab.url);
    } else {
      tab.loaded = true;
    }
  }

  private showInternalPage(tab: TabRecord, url: string): void {
    const page = internalPageOf(url)!;
    tab.url = url;
    tab.title = internalPageTitle(page);
    tab.isLoading = false;
    tab.favicon = null;
    tab.faviconHost = null;
    tab.zoomPercent = 100;
    tab.blockedAds = 0;
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.stopFindInPage('clearSelection');
    if (this.activeTabId === tab.id) {
      this.detachView(tab);
      this.guard?.onActivePageChanged?.(null);
    }
  }

  /**
   * Records the tab URL. Interstitial pages map back to the URL they replaced.
   * Only real commits may clear the blocked state: load-stop events can still
   * report the previous page after a request was cancelled by the guard.
   */
  private commitTabUrl(tab: TabRecord, url: string, isCommit: boolean): void {
    if (!url || isInternalUrl(tab.url)) {
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

  private insertInOrder(tab: TabRecord, afterTabId?: string): void {
    const pinnedCount = this.order.filter((id) => this.tabs.get(id)?.pinned).length;
    if (tab.pinned) {
      this.order.splice(pinnedCount, 0, tab.id);
      return;
    }
    const after = afterTabId ? this.order.indexOf(afterTabId) : -1;
    if (after === -1) {
      this.order.push(tab.id);
      return;
    }
    // Several links opened from one tab line up after it, in the order they were opened.
    let index = Math.max(after + 1, pinnedCount);
    while (index < this.order.length && this.tabs.get(this.order[index]!)?.openerId === afterTabId) {
      index += 1;
    }
    this.order.splice(index, 0, tab.id);
  }

  private activateTab(tabId: string): void {
    const nextTab = this.tabs.get(tabId);
    if (!nextTab) {
      return;
    }

    const currentTab = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
    if (currentTab && currentTab.id !== nextTab.id) {
      this.detachView(currentTab);
      if (!currentTab.view.webContents.isDestroyed()) currentTab.view.webContents.stopFindInPage('keepSelection');
    }

    this.activeTabId = nextTab.id;
    if (isInternalUrl(nextTab.url)) {
      this.detachView(nextTab);
    } else {
      this.attachView(nextTab);
      this.ensureLoaded(nextTab);
    }

    const internal = isInternalUrl(nextTab.url);
    this.guard?.onActivePageChanged?.(nextTab.blocked || internal ? null : nextTab.view.webContents.getURL() || null);
    this.emitState();
  }

  private attachView(tab: TabRecord): void {
    if (this.pageViewHidden || this.activeTabId !== tab.id || isInternalUrl(tab.url)) {
      return;
    }
    this.window.setBrowserView(tab.view);
    this.resizeActiveView();
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
    // Built-in pages and not-yet-loaded restored tabs hold a blank placeholder document
    // whose own navigation events must not change the tab.
    const internal = () => isInternalUrl(tab.url) || !tab.loaded;

    webContents.on('did-start-loading', () => {
      if (internal()) return;
      tab.isLoading = true;
      this.syncNavigationState(tab);
    });

    webContents.on('did-stop-loading', () => {
      if (internal()) return;
      tab.isLoading = false;
      if (!tab.blocked) {
        tab.title = webContents.getTitle() || tab.title;
      }
      this.commitTabUrl(tab, webContents.getURL(), false);
      this.syncNavigationState(tab);
    });

    webContents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument && !internal()) {
        tab.blockedAds = 0;
      }
    });

    webContents.on('page-title-updated', (_event, title) => {
      if (internal()) return;
      if (!tab.blocked) {
        tab.title = title;
        const url = webContents.getURL();
        if (isWebUrl(url) && !tab.checkingUrl) {
          for (const listener of this.titleListeners) listener({ tabId: tab.id, url, title });
        }
      }
      this.emitState();
    });

    webContents.on('page-favicon-updated', (_event, favicons) => {
      if (internal() || tab.blocked) return;
      const icon = favicons.find((candidate) => /^(https?:|data:image\/)/i.test(candidate)) ?? null;
      tab.favicon = icon;
      tab.faviconHost = hostOf(webContents.getURL());
      this.emitState();
    });

    webContents.on('audio-state-changed', (event) => {
      tab.audible = Boolean((event as unknown as { audible?: boolean }).audible ?? webContents.isCurrentlyAudible());
      this.emitState();
    });

    webContents.on('found-in-page', (_event, result) => {
      if (result.requestId !== tab.findRequestId) return;
      this.sendFindResult({ tabId: tab.id, activeMatch: result.activeMatchOrdinal ?? 0, matches: result.matches ?? 0, finalUpdate: result.finalUpdate });
    });

    webContents.on('context-menu', (_event, params) => {
      if (internal()) return;
      for (const listener of this.contextMenuListeners) listener(tab.id, params, webContents);
    });

    webContents.on('did-navigate', (_event, url) => {
      if (internal()) return;
      this.commitTabUrl(tab, url, true);
      if (isWebUrl(url) && hostOf(url) !== tab.faviconHost) {
        tab.favicon = null;
        tab.faviconHost = null;
      }
      tab.zoomPercent = Math.round(webContents.getZoomFactor() * 100);
      this.syncNavigationState(tab);
      this.afterTopLevelNavigation(tab, url);
    });

    webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame === false || internal()) {
        return;
      }
      this.commitTabUrl(tab, url, false);
      this.syncNavigationState(tab);
      // Single-page sites (YouTube) switch videos without a new request; check those too.
      if (this.guard && isWebUrl(url) && !tab.blocked && !tab.checkingUrl) {
        const decision = this.decide(tab, url);
        if (decision.kind !== 'allow') {
          this.applyGuardDecision(tab, decision, url);
          return;
        }
      }
      if (isWebUrl(url) && !tab.blocked && !tab.checkingUrl) {
        for (const listener of this.navigationListeners) listener({ tabId: tab.id, url, title: webContents.getTitle() });
      }
    });

    webContents.setWindowOpenHandler(({ url, disposition }) => {
      // Ctrl/middle-click opens in the background, next to this tab; target=_blank opens in front.
      if (isWebUrl(url)) {
        this.createTab(url, { activate: disposition !== 'background-tab', afterTabId: tab.id });
      }
      return { action: 'deny' };
    });

    webContents.on('did-finish-load', () => {
      const url = webContents.getURL();
      if (tab.blocked || !isWebUrl(url) || internal()) {
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
      tab.title = reload ? 'Reloading after crash…' : 'Page crashed. Press Reload to retry.';
      for (const listener of this.tabCrashedListeners) {
        listener({ tabId: tab.id, reason: details.reason, reloaded: reload });
      }
      if (reload) {
        webContents.reload();
      }
      this.emitState();
    });

    webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (internal()) return;
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

    if (!isWebUrl(url)) {
      if (isActiveTab) {
        guard?.onActivePageChanged?.(null);
      }
      return;
    }

    if (guard && !guard.isAllowed(url)) {
      const decision = this.decide(tab, url);
      if (decision.kind !== 'allow') {
        this.applyGuardDecision(tab, decision, url);
        return;
      }
    }

    const title = tab.view.webContents.getTitle();
    for (const listener of this.navigationListeners) listener({ tabId: tab.id, url, title });
    guard?.onPageCommitted?.({ tabId: tab.id, url, title, isActiveTab });
  }

  private syncNavigationState(tab: TabRecord): void {
    if (tab.view.webContents.isDestroyed()) {
      return;
    }
    if (isInternalUrl(tab.url)) {
      tab.canGoBack = tab.internalFromWeb && hasWebPage(tab);
      tab.canGoForward = tab.forwardToWeb && hasWebPage(tab);
    } else if (isAtSessionStart(tab)) {
      tab.canGoBack = tab.backToInternal !== null;
      tab.canGoForward = tab.view.webContents.canGoForward();
    } else {
      tab.canGoBack = tab.view.webContents.canGoBack();
      tab.canGoForward = tab.view.webContents.canGoForward();
    }
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
      checking: tab.checkingUrl !== null,
      favicon: tab.favicon,
      audible: tab.audible,
      muted: tab.muted,
      pinned: tab.pinned,
      zoomPercent: tab.zoomPercent,
      blockedAds: tab.blockedAds
    };
  }

  private getTab(tabId?: string): TabRecord | undefined {
    const resolvedTabId = tabId ?? this.activeTabId ?? undefined;
    if (!resolvedTabId) {
      return undefined;
    }

    return this.tabs.get(resolvedTabId);
  }

  private sendFindResult(result: FindResult): void {
    if (!this.window.isDestroyed()) {
      this.window.webContents.send(IPC_CHANNELS.FIND_RESULT, result);
    }
  }

  /** Coalesces frequent updates (blocked-ad counters) into one state push. */
  private scheduleEmit(): void {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.emitState();
    }, 300);
  }

  private emitState(): void {
    if (this.window.isDestroyed()) {
      return;
    }
    const snapshot = this.getSnapshot();
    this.window.webContents.send(IPC_CHANNELS.STATE_CHANGED, snapshot);
    for (const listener of this.stateListeners) listener(snapshot);
  }
}
