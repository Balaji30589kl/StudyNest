import { app, BrowserWindow, clipboard, Menu, nativeTheme, net, session, shell } from 'electron';
import path from 'node:path';
import { adBlockingActiveFor, BrowserSettings, sanitizeBrowserSettings } from '../../shared/browser-settings.js';
import { internalUrl, NEW_TAB_URL } from '../../shared/internal-pages.js';
import { BrowserCommand, ClearDataOptions, DefaultBrowserState, IPC_CHANNELS, TabAction } from '../../shared/ipc.js';
import { getSearchEngine } from '../../shared/search-engines.js';
import { buildSearchUrl } from '../../shared/url.js';
import { handleTrusted } from '../security/ipc-guard.js';
import { JsonFileStore } from '../storage/json-file-store.js';
import type { TabManager } from '../tab-manager.js';
import { AdBlocker } from './ad-blocker.js';
import { BookmarksService, parseBookmarks } from './bookmarks-service.js';
import { HistoryService, parseHistory } from './history-service.js';
import { buildAppMenu, buildBookmarkMenu, buildPageMenu, buildTabMenu } from './menus.js';
import { parseSavedSession, SavedSession, toSavedSession } from './session-restore.js';

type Log = (level: 'info' | 'warn', message: string, data?: Record<string, unknown>) => void;

/** Window background per theme, so resizing never flashes the wrong color. */
const BACKGROUND = { light: '#f3f1ec', dark: '#1d1e20' } as const;

export type BrowserServices = {
  settings: SettingsService;
  history: HistoryService;
  bookmarks: BookmarksService;
  adBlocker: AdBlocker;
  /** Tabs to open at startup (restored session or one new tab). */
  restoreSession: () => void;
  openPage: (page: 'history' | 'bookmarks' | 'settings', section?: string) => void;
  toggleBookmarkForActivePage: () => void;
  toggleBookmarksBar: () => void;
  flush: () => void;
};

export class SettingsService {
  private settings: BrowserSettings;
  private readonly listeners = new Set<(settings: BrowserSettings) => void>();

  constructor(private readonly store: JsonFileStore<BrowserSettings>) {
    this.settings = store.load();
  }

  get(): BrowserSettings {
    return { ...this.settings, adBlockExceptions: [...this.settings.adBlockExceptions] };
  }

  update(changes: unknown): BrowserSettings {
    const merged = sanitizeBrowserSettings({ ...this.settings, ...(typeof changes === 'object' && changes !== null ? changes : {}) }, this.settings);
    this.settings = merged;
    this.store.save(merged);
    const snapshot = this.get();
    for (const listener of this.listeners) listener(snapshot);
    return snapshot;
  }

  onChange(listener: (settings: BrowserSettings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  flush(): void {
    this.store.flush();
  }
}

function applyTheme(window: BrowserWindow, settings: BrowserSettings): void {
  // Native menus, scrollbars in pages that follow the system, and dev tools use this too.
  nativeTheme.themeSource = settings.theme;
  if (!window.isDestroyed()) {
    window.setBackgroundColor(nativeTheme.shouldUseDarkColors ? BACKGROUND.dark : BACKGROUND.light);
  }
}

/** First http(s) URL in a command line (links opened from other apps when StudyNest is the default browser). */
export function urlFromArgv(argv: readonly string[]): string | null {
  return argv.find((arg) => /^https?:\/\//i.test(arg)) ?? null;
}

function defaultBrowserState(): DefaultBrowserState {
  return {
    isDefault: app.isDefaultProtocolClient('https') && app.isDefaultProtocolClient('http'),
    // Development builds would register electron.exe, so only installed builds can offer this.
    canSet: app.isPackaged && process.platform === 'win32'
  };
}

export function setupBrowserServices(options: {
  window: BrowserWindow;
  manager: TabManager;
  sendCommand: (command: BrowserCommand) => void;
  isStudyActive: () => boolean;
  /** Requests Study Mode refuses (focus rules); checked before the ad blocker. */
  studyBlocksRequest?: (requestUrl: string, pageUrl: string | null) => boolean;
  log: Log;
}): BrowserServices {
  const { window, manager, sendCommand, log } = options;
  const userData = app.getPath('userData');
  const send = (channel: string, payload: unknown) => {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  };

  // Settings ------------------------------------------------------------------
  const settings = new SettingsService(new JsonFileStore(path.join(userData, 'settings.json'), (raw) => sanitizeBrowserSettings(raw)));
  applyTheme(window, settings.get());
  manager.setSearchEngineProvider(() => settings.get().searchEngine);
  settings.onChange((next) => {
    applyTheme(window, next);
    send(IPC_CHANNELS.SETTINGS_CHANGED, next);
  });
  nativeTheme.on('updated', () => applyTheme(window, settings.get()));
  handleTrusted(IPC_CHANNELS.SETTINGS_REQUEST, () => settings.get());
  handleTrusted(IPC_CHANNELS.SETTINGS_UPDATE, (_event, changes: unknown) => settings.update(changes));

  // History -------------------------------------------------------------------
  const history = new HistoryService(new JsonFileStore(path.join(userData, 'history.json'), parseHistory, 2000));
  manager.onNavigationCommitted(({ url, title }) => history.record(url, title));
  manager.onTitleChanged(({ url, title }) => history.updateTitle(url, title));
  let historyTimer: ReturnType<typeof setTimeout> | null = null;
  history.onChange(() => {
    // Open History pages refresh at most a few times a second.
    if (historyTimer) return;
    historyTimer = setTimeout(() => {
      historyTimer = null;
      send(IPC_CHANNELS.HISTORY_CHANGED, null);
    }, 400);
  });
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  handleTrusted(IPC_CHANNELS.HISTORY_QUERY, (_event, query: unknown) => {
    const candidate = typeof query === 'object' && query !== null ? (query as Record<string, unknown>) : {};
    return history.query({
      text: text(candidate.text),
      limit: typeof candidate.limit === 'number' ? candidate.limit : undefined,
      before: typeof candidate.before === 'number' ? candidate.before : undefined
    });
  });
  handleTrusted(IPC_CHANNELS.HISTORY_SUGGEST, (_event, query: unknown) => history.suggest(text(query).slice(0, 200)));
  handleTrusted(IPC_CHANNELS.HISTORY_TOP_SITES, () => history.topSites(8));
  handleTrusted(IPC_CHANNELS.HISTORY_DELETE, (_event, ids: unknown) => {
    history.delete(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []);
  });

  // Bookmarks -----------------------------------------------------------------
  const bookmarks = new BookmarksService(new JsonFileStore(path.join(userData, 'bookmarks.json'), parseBookmarks));
  bookmarks.onChange((list) => send(IPC_CHANNELS.BOOKMARKS_CHANGED, list));
  handleTrusted(IPC_CHANNELS.BOOKMARKS_REQUEST, () => bookmarks.list());
  handleTrusted(IPC_CHANNELS.BOOKMARKS_TOGGLE, (_event, url: unknown, title: unknown) => bookmarks.toggle(text(url), text(title)));
  handleTrusted(IPC_CHANNELS.BOOKMARKS_REMOVE, (_event, id: unknown) => bookmarks.remove(text(id)));
  handleTrusted(IPC_CHANNELS.BOOKMARKS_UPDATE, (_event, id: unknown, changes: unknown) => {
    const candidate = typeof changes === 'object' && changes !== null ? (changes as Record<string, unknown>) : {};
    return bookmarks.update(text(id), {
      title: typeof candidate.title === 'string' ? candidate.title : undefined,
      url: typeof candidate.url === 'string' ? candidate.url : undefined
    });
  });
  handleTrusted(IPC_CHANNELS.BOOKMARKS_MOVE, (_event, id: unknown, index: unknown) => bookmarks.move(text(id), typeof index === 'number' ? index : 0));

  const toggleBookmarkForActivePage = () => {
    const page = manager.getActivePage();
    if (page) bookmarks.toggle(page.url, page.title);
  };
  const toggleBookmarksBar = () => settings.update({ showBookmarksBar: !settings.get().showBookmarksBar });

  // Pages and tabs --------------------------------------------------------------
  /** Opens a built-in page, reusing an open tab showing it. */
  const openPage = (page: 'history' | 'bookmarks' | 'settings', section?: string) => {
    const url = internalUrl(page, section);
    const existing = manager.getSnapshot().tabs.find((tab) => tab.url.split('#', 1)[0] === internalUrl(page));
    if (existing) {
      manager.switchTab(existing.id);
      manager.navigate(url, existing.id);
    } else {
      manager.createTab(url, { activate: true, afterTabId: manager.getSnapshot().activeTabId ?? undefined });
    }
  };

  handleTrusted(IPC_CHANNELS.STOP, (_event, tabId?: unknown) => manager.stop(typeof tabId === 'string' ? tabId : undefined));
  handleTrusted(IPC_CHANNELS.TAB_ACTION, (_event, raw: unknown) => {
    const action = raw as TabAction;
    const tab = manager.getSnapshot().tabs.find((entry) => entry.id === action?.tabId);
    if (!tab) return manager.getSnapshot();
    switch (action.type) {
      case 'mute':
        return manager.setMuted(tab.id, !tab.muted);
      case 'pin':
        return manager.setPinned(tab.id, !tab.pinned);
      case 'duplicate':
        return manager.duplicateTab(tab.id);
      case 'reload':
        return manager.refresh(tab.id);
      case 'close-others':
        return manager.closeOtherTabs(tab.id);
      case 'close-right':
        return manager.closeTabsToRight(tab.id);
      case 'move':
        return manager.moveTab(tab.id, typeof action.index === 'number' ? action.index : 0);
      default:
        return manager.getSnapshot();
    }
  });

  handleTrusted(IPC_CHANNELS.FIND, (_event, query: unknown, findOptions: unknown) => {
    const candidate = typeof findOptions === 'object' && findOptions !== null ? (findOptions as Record<string, unknown>) : {};
    manager.find(text(query).slice(0, 500), { forward: candidate.forward !== false, findNext: candidate.findNext === true });
  });
  handleTrusted(IPC_CHANNELS.FIND_STOP, () => manager.stopFind());
  handleTrusted(IPC_CHANNELS.PRINT, () => manager.print());
  handleTrusted(IPC_CHANNELS.ZOOM, (_event, steps: unknown) => manager.zoom(typeof steps === 'number' ? Math.sign(steps) : 0));

  // Menus -----------------------------------------------------------------------
  const popup = (template: Electron.MenuItemConstructorOptions[], position?: { x: number; y: number }) => {
    Menu.buildFromTemplate(template).popup({ window, ...(position ? { x: Math.round(position.x), y: Math.round(position.y) } : {}) });
  };

  handleTrusted(IPC_CHANNELS.TAB_MENU, (_event, tabId: unknown) => {
    const snapshot = manager.getSnapshot();
    const index = snapshot.tabs.findIndex((tab) => tab.id === tabId);
    const tab = snapshot.tabs[index];
    if (!tab) return;
    popup(
      buildTabMenu({
        pinned: tab.pinned,
        muted: tab.muted,
        isOnlyTab: snapshot.tabs.length <= 1,
        hasTabsToRight: index < snapshot.tabs.length - 1,
        canReopen: true,
        newTabToRight: () => manager.createTab(NEW_TAB_URL, { activate: true, afterTabId: tab.id }),
        reload: () => manager.refresh(tab.id),
        duplicate: () => manager.duplicateTab(tab.id),
        togglePin: () => manager.setPinned(tab.id, !tab.pinned),
        toggleMute: () => manager.setMuted(tab.id, !tab.muted),
        close: () => manager.closeTab(tab.id),
        closeOthers: () => manager.closeOtherTabs(tab.id),
        closeToRight: () => manager.closeTabsToRight(tab.id),
        reopenClosed: () => manager.reopenClosedTab()
      })
    );
  });

  handleTrusted(IPC_CHANNELS.APP_MENU, (_event, position: unknown) => {
    const point = typeof position === 'object' && position !== null ? (position as { x?: unknown; y?: unknown }) : {};
    const snapshot = manager.getSnapshot();
    const active = snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId);
    popup(
      buildAppMenu({
        zoomPercent: active?.zoomPercent ?? 100,
        canZoom: Boolean(active && /^https?:/.test(active.url) && !active.blocked),
        showBookmarksBar: settings.get().showBookmarksBar,
        studyActive: options.isStudyActive(),
        newTab: () => sendCommand({ type: 'new-tab' }),
        reopenClosed: () => manager.reopenClosedTab(),
        openPage: (page) => openPage(page),
        openPanel: (panel) => sendCommand({ type: 'open-panel', panel }),
        zoom: (steps) => manager.zoom(steps),
        find: () => sendCommand({ type: 'find' }),
        print: () => manager.print(),
        toggleBookmarksBar,
        clearData: () => openPage('settings', 'privacy'),
        quit: () => app.quit()
      }),
      typeof point.x === 'number' && typeof point.y === 'number' ? { x: point.x, y: point.y } : undefined
    );
  });

  handleTrusted(IPC_CHANNELS.BOOKMARK_MENU, (_event, id: unknown) => {
    const bookmark = bookmarks.list().find((entry) => entry.id === id);
    if (!bookmark) return;
    popup(
      buildBookmarkMenu({
        open: () => manager.navigate(bookmark.url),
        openInNewTab: () => manager.createTab(bookmark.url, { activate: false, afterTabId: manager.getSnapshot().activeTabId ?? undefined }),
        edit: () => openPage('bookmarks', `edit=${bookmark.id}`),
        remove: () => bookmarks.remove(bookmark.id)
      })
    );
  });

  manager.onContextMenu((tabId, params, webContents) => {
    const tab = manager.getSnapshot().tabs.find((entry) => entry.id === tabId);
    const engine = getSearchEngine(settings.get().searchEngine);
    popup(
      buildPageMenu(params, {
        searchEngineName: engine.name,
        canGoBack: tab?.canGoBack ?? false,
        canGoForward: tab?.canGoForward ?? false,
        openInNewTab: (url) => manager.createTab(url, { activate: false, afterTabId: tabId }),
        copyText: (value) => clipboard.writeText(value),
        copyImageAt: (x, y) => webContents.copyImageAt(x, y),
        download: (url) => webContents.downloadURL(url),
        searchFor: (query) => manager.createTab(buildSearchUrl(query, engine.id), { activate: true, afterTabId: tabId }),
        replaceMisspelling: (word) => webContents.replaceMisspelling(word),
        addToDictionary: (word) => webContents.session.addWordToSpellCheckerDictionary(word),
        back: () => manager.goBack(tabId),
        forward: () => manager.goForward(tabId),
        reload: () => manager.refresh(tabId),
        print: () => manager.print(),
        inspect: (x, y) => webContents.inspectElement(x, y)
      })
    );
  });

  // Ad blocking ---------------------------------------------------------------
  const hostOf = (url: string | null) => {
    if (!url) return null;
    try {
      return new URL(url).hostname;
    } catch {
      return null;
    }
  };
  const adBlocker = new AdBlocker({
    session: session.defaultSession,
    cacheFile: path.join(userData, 'adblock-engine.bin'),
    fetchImpl: (url) => net.fetch(url),
    // Ads are always blocked during Study Mode, even where the user allowed them.
    isActiveFor: (pageUrl) => options.isStudyActive() || adBlockingActiveFor(settings.get(), hostOf(pageUrl)),
    isChrome: (id) => !window.isDestroyed() && window.webContents.id === id,
    log
  });
  manager.setSubresourceFilter((details, pageUrl, callback) => {
    if (options.studyBlocksRequest?.(details.url, pageUrl)) {
      callback({ cancel: true });
      return;
    }
    adBlocker.filter(details, pageUrl, callback);
  });
  adBlocker.onChange((state) => send(IPC_CHANNELS.ADBLOCK_CHANGED, state));
  handleTrusted(IPC_CHANNELS.ADBLOCK_STATE_REQUEST, () => adBlocker.getState());
  // STUDYNEST_ADBLOCK=off turns the ad blocker off entirely (end-to-end tests run without downloaded lists).
  if (process.env.STUDYNEST_ADBLOCK !== 'off') void adBlocker.start();

  // Privacy -------------------------------------------------------------------
  handleTrusted(IPC_CHANNELS.CLEAR_BROWSING_DATA, async (_event, raw: unknown) => {
    const candidate = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<ClearDataOptions>;
    const since = typeof candidate.since === 'number' && candidate.since > 0 ? candidate.since : 0;
    if (candidate.history) history.clear(since);
    if (candidate.cache) await session.defaultSession.clearCache();
    if (candidate.cookies) {
      await session.defaultSession.clearStorageData({
        storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage', 'websql', 'shadercache', 'filesystem']
      });
    }
    log('info', 'browsing data cleared', { since, history: Boolean(candidate.history), cookies: Boolean(candidate.cookies), cache: Boolean(candidate.cache) });
  });

  // Default browser -----------------------------------------------------------
  handleTrusted(IPC_CHANNELS.DEFAULT_BROWSER_REQUEST, () => defaultBrowserState());
  handleTrusted(IPC_CHANNELS.DEFAULT_BROWSER_SET, async () => {
    const state = defaultBrowserState();
    if (state.canSet) {
      app.setAsDefaultProtocolClient('http');
      app.setAsDefaultProtocolClient('https');
      // Windows only lets the user confirm the default browser in Settings.
      await shell.openExternal('ms-settings:defaultapps');
    }
    return defaultBrowserState();
  });

  // Session -------------------------------------------------------------------
  const sessionStore = new JsonFileStore<SavedSession>(path.join(userData, 'session.json'), parseSavedSession, 1000);
  let restored = false;
  manager.onStateChanged(() => {
    if (!restored) return;
    const { tabs, activeIndex } = manager.getSessionTabs();
    sessionStore.save(toSavedSession(tabs, activeIndex));
  });

  const restoreSession = () => {
    const saved = settings.get().startup === 'restore' ? sessionStore.load() : null;
    const launchUrl = urlFromArgv(process.argv);
    if (saved && saved.tabs.length > 0) {
      saved.tabs.forEach((tab, index) => {
        manager.createTab(tab.url, { activate: index === saved.activeIndex && !launchUrl, lazy: index !== saved.activeIndex || Boolean(launchUrl), pinned: tab.pinned, title: tab.title });
      });
    }
    if (launchUrl) {
      manager.createTab(launchUrl, true);
    } else if (!saved || saved.tabs.length === 0) {
      manager.createTab(NEW_TAB_URL, true);
    }
    restored = true;
    const { tabs, activeIndex } = manager.getSessionTabs();
    sessionStore.save(toSavedSession(tabs, activeIndex));
  };

  return {
    settings,
    history,
    bookmarks,
    adBlocker,
    restoreSession,
    openPage,
    toggleBookmarkForActivePage,
    toggleBookmarksBar,
    flush: () => {
      settings.flush();
      history.flush();
      bookmarks.flush();
      sessionStore.flush();
      adBlocker.stop();
    }
  };
}
