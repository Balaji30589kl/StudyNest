import { BrowserView, BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { BROWSER_CHROME_HEIGHT, BrowserStateSnapshot, BrowserTabState, IPC_CHANNELS } from '../shared/ipc.js';
import { isSafeNavigationUrl, normalizeNavigationInput } from '../shared/url.js';

type TabRecord = {
  id: string;
  view: BrowserView;
  title: string;
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
};

export class TabManager {
  private readonly tabs = new Map<string, TabRecord>();
  private activeTabId: string | null = null;
  private chromeHeight = BROWSER_CHROME_HEIGHT;

  constructor(private readonly window: BrowserWindow) {}

  createTab(inputUrl = 'https://example.com', activate = true): BrowserStateSnapshot {
    const url = normalizeNavigationInput(inputUrl);
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
      isLoading: true
    };

    this.attachBrowserViewEvents(tab);
    this.tabs.set(id, tab);

    if (activate || this.activeTabId === null) {
      this.activateTab(id);
    } else {
      view.webContents.loadURL(url);
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

  closeTab(tabId: string): BrowserStateSnapshot {
    const tab = this.tabs.get(tabId);

    if (!tab) {
      return this.getSnapshot();
    }

    const wasActive = this.activeTabId === tabId;
    this.detachView(tab);
    this.tabs.delete(tabId);

    if (this.tabs.size === 0) {
      this.activeTabId = null;
      this.createTab('https://example.com', true);
    } else if (wasActive) {
      const nextTab = this.tabs.values().next().value as TabRecord | undefined;
      if (nextTab) {
        this.activateTab(nextTab.id);
      }
    }

    this.emitState();
    return this.getSnapshot();
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
    tab.view.webContents.loadURL(url);
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

  private activateTab(tabId: string): void {
    const nextTab = this.tabs.get(tabId);
    if (!nextTab) {
      return;
    }

    const currentTab = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
    if (currentTab && currentTab.id !== nextTab.id) {
      this.detachView(currentTab);
    }

    this.window.setBrowserView(nextTab.view);
    this.activeTabId = nextTab.id;
    this.resizeActiveView();

    if (nextTab.view.webContents.getURL().length === 0 || nextTab.view.webContents.getURL() === 'about:blank') {
      nextTab.view.webContents.loadURL(nextTab.url);
    }

    this.emitState();
  }

  private resizeActiveView(): void {
    const activeTab = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
    if (!activeTab) {
      return;
    }

    const contentBounds = this.window.getContentBounds();
    activeTab.view.setBounds({
      x: 0,
      y: this.chromeHeight,
      width: contentBounds.width,
      height: Math.max(contentBounds.height - this.chromeHeight, 0)
    });
    activeTab.view.setAutoResize({ width: true, height: true });
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
      tab.title = webContents.getTitle() || tab.title;
      tab.url = webContents.getURL() || tab.url;
      this.syncNavigationState(tab);
    });

    webContents.on('page-title-updated', (_event, title) => {
      tab.title = title;
      this.emitState();
    });

    webContents.on('did-navigate', (_event, url) => {
      tab.url = url;
      this.syncNavigationState(tab);
    });

    webContents.on('did-navigate-in-page', (_event, url) => {
      tab.url = url;
      this.syncNavigationState(tab);
    });

    webContents.setWindowOpenHandler(({ url }) => {
      this.createTab(url, true);
      return { action: 'deny' };
    });

    webContents.on('did-fail-load', () => {
      tab.isLoading = false;
      this.syncNavigationState(tab);
    });
  }

  private syncNavigationState(tab: TabRecord): void {
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
      isLoading: tab.isLoading
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
    this.window.webContents.send(IPC_CHANNELS.STATE_CHANGED, this.getSnapshot());
  }
}
