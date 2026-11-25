import { app, BrowserWindow, Event as ElectronEvent, Input, net, Notification, screen, session } from 'electron';
import path from 'node:path';
import autoUpdaterModule from 'electron-updater';
import { fileURLToPath } from 'node:url';
import { NEW_TAB_URL } from '../shared/internal-pages.js';
import { BrowserServices, setupBrowserServices, urlFromArgv } from './browser/browser-services.js';
import { BROWSER_CHROME_HEIGHT, BrowserStateSnapshot, IPC_CHANNELS } from '../shared/ipc.js';
import { AppConfig, loadAppConfig } from './app-config.js';
import { ClassificationClient, parseAiData } from './ai/classification-client.js';
import { GatewayProvider } from './ai/gateway-provider.js';
import { fetchPageMetadata } from './ai/page-metadata.js';
import { RuleBasedProvider } from './ai/rule-based-provider.js';
import { PolicyService } from './policy/policy-service.js';
import { Logger } from './observability/logger.js';
import { handleTrusted, setTrustedSender } from './security/ipc-guard.js';
import { parseSitePermissions } from './security/permission-policy.js';
import { SitePermissions } from './security/site-permissions.js';
import { UpdateService } from './update/update-service.js';
import { setupProductServices } from './product/product-services.js';
import { JsonFileStore } from './storage/json-file-store.js';
import type { AccountService } from './account/account-service.js';
import { FocusView } from './study/focus-view.js';
import { focusBlocksRequest } from '../shared/focus-rules.js';
import { StudyModeService } from './study/study-mode-service.js';
import { JsonFileStudyStore } from './study/study-store.js';
import { TabManager } from './tab-manager.js';
import { DownloadManager } from './downloads/download-manager.js';
import { BrowserCommand } from '../shared/ipc.js';
import { isRendererCommand, matchShortcut, ShortcutAction } from './shortcuts.js';
import { DEFAULT_WINDOW_SIZE, MIN_WINDOW_SIZE, parseWindowState, resolveWindowBounds, WindowState } from './window-state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let tabManager: TabManager | null = null;
let studyStore: JsonFileStudyStore | null = null;
let studyService: StudyModeService | null = null;
let classificationClient: ClassificationClient | null = null;
let policyService: PolicyService | null = null;
let accountService: AccountService | null = null;
let updateService: UpdateService | null = null;
let browserServices: BrowserServices | null = null;
let logger: Logger = new Logger({ filePath: null, echo: true });

let windowStateStore: JsonFileStore<WindowState> | null = null;

function createMainWindow(): BrowserWindow {
  windowStateStore = new JsonFileStore(path.join(app.getPath('userData'), 'window-state.json'), parseWindowState, 300);
  const savedState = windowStateStore.load();
  const bounds = resolveWindowBounds(
    savedState.bounds,
    screen.getAllDisplays().map((display) => display.workArea)
  );

  const window = new BrowserWindow({
    ...(bounds ?? DEFAULT_WINDOW_SIZE),
    minWidth: MIN_WINDOW_SIZE.width,
    minHeight: MIN_WINDOW_SIZE.height,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    backgroundColor: '#f3f1ec',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, '../preload/index.cjs')
    }
  });

  window.once('ready-to-show', () => {
    if (savedState.maximized) {
      window.maximize();
    }
    window.show();
  });
  trackWindowState(window);

  if (process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(path.resolve(__dirname, '../../dist/index.html'));
  }

  return window;
}

/** Persists size, position and maximized state (normal bounds, so restoring un-maximizes correctly). */
function trackWindowState(window: BrowserWindow): void {
  const save = () => {
    if (window.isDestroyed() || window.isMinimized()) {
      return;
    }
    windowStateStore?.save({ bounds: window.getNormalBounds(), maximized: window.isMaximized() });
  };
  for (const event of ['resize', 'move', 'maximize', 'unmaximize'] as const) {
    window.on(event as 'resize', save);
  }
  window.on('close', () => {
    save();
    windowStateStore?.flush();
  });
}

function sendBrowserCommand(window: BrowserWindow, command: BrowserCommand): void {
  if (!window.isDestroyed()) {
    // Move keyboard focus from the page to the browser chrome first.
    window.webContents.focus();
    window.webContents.send(IPC_CHANNELS.BROWSER_COMMAND, command);
  }
}

function runShortcut(window: BrowserWindow, manager: TabManager, action: ShortcutAction): void {
  if (isRendererCommand(action)) {
    sendBrowserCommand(window, action);
    return;
  }
  switch (action.type) {
    case 'open-page':
      browserServices?.openPage(action.page, action.section);
      return;
    case 'bookmark-page':
      browserServices?.toggleBookmarkForActivePage();
      return;
    case 'toggle-bookmarks-bar':
      browserServices?.toggleBookmarksBar();
      return;
    case 'print':
      manager.print();
      return;
    case 'devtools': {
      const contents = manager.getActiveWebContents();
      if (contents) {
        if (contents.isDevToolsOpened()) contents.closeDevTools();
        else contents.openDevTools({ mode: 'detach' });
      }
      return;
    }
    case 'home':
      manager.navigate(NEW_TAB_URL);
      return;
    case 'close-tab': {
      const activeId = manager.getSnapshot().activeTabId;
      if (activeId) manager.closeTab(activeId);
      return;
    }
    case 'reopen-closed-tab':
      manager.reopenClosedTab();
      return;
    case 'next-tab':
      manager.cycleTab(1);
      return;
    case 'previous-tab':
      manager.cycleTab(-1);
      return;
    case 'select-tab':
      manager.selectTabAt(action.index);
      return;
    case 'select-last-tab':
      manager.selectTabAt(-1);
      return;
    case 'reload':
      manager.refresh();
      return;
    case 'hard-reload':
      manager.hardReload();
      return;
    case 'back':
      manager.goBack();
      return;
    case 'forward':
      manager.goForward();
      return;
    case 'zoom-in':
      manager.zoom(1);
      return;
    case 'zoom-out':
      manager.zoom(-1);
      return;
    case 'zoom-reset':
      manager.zoom(0);
      return;
  }
}

/** Shortcuts work whether focus is in the browser chrome or inside a web page. */
function setupShortcuts(window: BrowserWindow, manager: TabManager): void {
  const handle = (event: ElectronEvent, input: Input) => {
    const action = matchShortcut(input);
    if (!action) {
      return;
    }
    event.preventDefault();
    runShortcut(window, manager, action);
  };
  window.webContents.on('before-input-event', handle);
  manager.onTabInput(handle);
}

function setupDownloads(window: BrowserWindow): DownloadManager {
  const downloads = new DownloadManager(session.defaultSession, (message, data) => logger.write('info', 'downloads', message, data));
  downloads.onChange(() => {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.DOWNLOADS_CHANGED, downloads.getSnapshot());
    }
  });
  const idOf = (value: unknown) => (typeof value === 'string' ? value : '');
  handleTrusted(IPC_CHANNELS.DOWNLOADS_STATE_REQUEST, () => downloads.getSnapshot());
  handleTrusted(IPC_CHANNELS.DOWNLOADS_OPEN, (_event, id: unknown) => downloads.open(idOf(id)));
  handleTrusted(IPC_CHANNELS.DOWNLOADS_SHOW, (_event, id: unknown) => downloads.showInFolder(idOf(id)));
  handleTrusted(IPC_CHANNELS.DOWNLOADS_CANCEL, (_event, id: unknown) => downloads.cancel(idOf(id)));
  handleTrusted(IPC_CHANNELS.DOWNLOADS_CLEAR, () => {
    downloads.clearFinished();
    return downloads.getSnapshot();
  });
  return downloads;
}

function setupWindowControls(window: BrowserWindow): void {
  handleTrusted(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
    window.minimize();
  });

  handleTrusted(IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE, () => {
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
  });

  handleTrusted(IPC_CHANNELS.WINDOW_CLOSE, () => {
    window.close();
  });
}

function setupBrowserIpc(window: BrowserWindow, manager: TabManager): void {
  handleTrusted(IPC_CHANNELS.STATE_REQUEST, () => manager.getSnapshot());
  handleTrusted(IPC_CHANNELS.NEW_TAB, (_event, inputUrl?: unknown) => manager.createTab(typeof inputUrl === 'string' && inputUrl ? inputUrl : NEW_TAB_URL));
  handleTrusted(IPC_CHANNELS.CLOSE_TAB, (_event, tabId: string) => manager.closeTab(tabId));
  handleTrusted(IPC_CHANNELS.SWITCH_TAB, (_event, tabId: string) => manager.switchTab(tabId));
  handleTrusted(IPC_CHANNELS.NAVIGATE, (_event, payload: { url: string; tabId?: string }) => {
    return manager.navigate(typeof payload?.url === 'string' ? payload.url : '', payload?.tabId);
  });
  handleTrusted(IPC_CHANNELS.GO_BACK, (_event, tabId?: string) => manager.goBack(tabId));
  handleTrusted(IPC_CHANNELS.GO_FORWARD, (_event, tabId?: string) => manager.goForward(tabId));
  handleTrusted(IPC_CHANNELS.REFRESH, (_event, tabId?: string) => manager.refresh(tabId));
  handleTrusted(IPC_CHANNELS.SET_CHROME_HEIGHT, (_event, height: number) => {
    manager.setChromeHeight(height);
  });
  handleTrusted(IPC_CHANNELS.SET_CONTENT_INSET_RIGHT, (_event, width: unknown) => {
    manager.setContentInsetRight(typeof width === 'number' ? width : 0);
  });
  handleTrusted(IPC_CHANNELS.CAPTURE_PAGE, () => manager.capturePageSnapshot());
  handleTrusted(IPC_CHANNELS.SET_PAGE_VIEW_HIDDEN, (_event, hidden: unknown) => {
    manager.setPageViewHidden(hidden === true);
  });

  window.on('resize', () => {
    manager.layoutActiveTab();
  });
}

function showDesktopNotification(title: string, body: string): void {
  if (Notification.isSupported()) {
    new Notification({ title, body, silent: false }).show();
  }
}

/**
 * Folder holding files shipped next to the app (policy/, config/). Packaged
 * builds keep them in resources/; development reads them from the repo.
 */
function resourceDir(name: string): string {
  return app.isPackaged ? path.join(process.resourcesPath, name) : path.join(app.getAppPath(), name);
}

/**
 * Backend rules and the AI pipeline. The block/allow lists come from policy
 * files (refreshed from the gateway); classification goes through the gateway,
 * which holds the LLM key, with offline keyword rules as the fallback.
 */
function setupPolicyAndClassification(window: BrowserWindow, config: AppConfig): { policy: PolicyService; client: ClassificationClient } {
  const userData = app.getPath('userData');
  const policy = new PolicyService({
    bundledDir: resourceDir('policy'),
    cacheFile: path.join(userData, 'policy-cache.json'),
    overrideDir: process.env.STUDYNEST_POLICY_DIR || null,
    getGatewayUrl: () => config.gatewayUrl,
    getToken: () => config.gatewayToken,
    fetchImpl: (input, init) => net.fetch(input as string, init),
    log: (level, message, data) => logger.write(level, 'policy', message, data)
  });

  const client = new ClassificationClient({
    store: new JsonFileStore(path.join(userData, 'ai-data.json'), parseAiData),
    primary: new GatewayProvider({
      getUrl: () => config.gatewayUrl,
      getToken: () => config.gatewayToken,
      fetchImpl: (input, init) => net.fetch(input as string, init)
    }),
    fallback: new RuleBasedProvider(),
    // Fetched in main, with the browser session's cookies, before the tab renders anything.
    fetchMetadata: (url, host, key) => fetchPageMetadata(url, host, key, { fetchImpl: (input, init) => net.fetch(input as string, init) }),
    getPolicy: () => policy.getPolicy().classification,
    getGatewayUrl: () => config.gatewayUrl
  });

  client.onChange(() => {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.AI_STATE_CHANGED, client.getSnapshot());
    }
  });
  handleTrusted(IPC_CHANNELS.AI_STATE_REQUEST, () => client.getSnapshot());
  handleTrusted(IPC_CHANNELS.AI_CLEAR_CACHE, () => client.clearCache());
  handleTrusted(IPC_CHANNELS.POLICY_STATE_REQUEST, () => policy.getSnapshot());
  return { policy, client };
}

/**
 * Study Mode lives entirely in the main process. The renderer only receives
 * snapshots and sends user intents; the service decides and the tab manager
 * enforces through its NavigationGuard hook, before pages render.
 */
function setupStudyMode(window: BrowserWindow, manager: TabManager, policy: PolicyService, client: ClassificationClient): StudyModeService {
  studyStore = new JsonFileStudyStore(path.join(app.getPath('userData'), 'study-data.json'));
  const service = new StudyModeService({
    store: studyStore,
    notify: showDesktopNotification,
    getPolicy: () => policy.getPolicy(),
    getPolicySnapshot: () => policy.getSnapshot(),
    // Synchronous cache lookup; uncached pages are classified through `classify` first.
    classificationLookup: (url) => client.peek(url),
    classify: (url) => client.classify(url)
  });

  service.onChange((kind) => {
    if (kind === 'policy') {
      manager.revalidateTabs();
    }
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.STUDY_STATE_CHANGED, service.getSnapshot());
    }
  });
  // New rules from the gateway: re-check what is open.
  policy.onChange(() => service.policyChanged());

  handleTrusted(IPC_CHANNELS.STUDY_STATE_REQUEST, () => service.getSnapshot());
  handleTrusted(IPC_CHANNELS.STUDY_START, (_event, durationMinutes?: unknown) =>
    service.startSession(durationMinutes === null ? null : typeof durationMinutes === 'number' ? durationMinutes : undefined)
  );
  handleTrusted(IPC_CHANNELS.STUDY_STOP, () => service.stopSession('stopped'));
  handleTrusted(IPC_CHANNELS.STUDY_UPDATE_SETTINGS, (_event, settings: unknown) => service.updateSettings(settings));
  handleTrusted(IPC_CHANNELS.STUDY_CLEAR_HISTORY, () => service.clearHistory());

  window.on('blur', () => service.setWindowFocused(false));
  window.on('focus', () => service.setWindowFocused(true));

  manager.setNavigationGuard(service);

  // Focus view: hide recommendation feeds, hover previews, Shorts and comments inside pages during a session.
  const focus = new FocusView({
    getRules: () => policy.getPolicy().focus,
    isStudyActive: () => service.getSnapshot().session !== null,
    getOpenPages: () => manager.getWebPages(),
    log: (message, data) => logger.write('warn', 'focus', message, data)
  });
  manager.onDocumentReady((page) => focus.onDocumentReady(page));
  service.onChange(() => focus.refresh());
  return service;
}

/** Keeps the app usable when a renderer or a page crashes. */
function setupResilience(window: BrowserWindow, manager: TabManager): void {
  const log = logger.scope('resilience');
  let chromeCrashes = 0;

  window.webContents.on('render-process-gone', (_event, details) => {
    chromeCrashes += 1;
    log.error('browser chrome renderer exited', { reason: details.reason, exitCode: details.exitCode, crashes: chromeCrashes });
    if (details.reason !== 'clean-exit' && chromeCrashes <= 3 && !window.isDestroyed()) {
      window.webContents.reload();
    }
  });
  window.webContents.on('unresponsive', () => log.warn('browser chrome unresponsive'));

  manager.onTabCrashed(({ reason, reloaded }) => log.warn('tab renderer exited', { reason, reloaded }));
}

function setupSitePermissions(window: BrowserWindow): SitePermissions {
  const permissions = new SitePermissions(
    window,
    new JsonFileStore(path.join(app.getPath('userData'), 'site-permissions.json'), parseSitePermissions),
    (message, data) => logger.write('info', 'permissions', message, data)
  );
  permissions.install(session.defaultSession);
  handleTrusted(IPC_CHANNELS.PERMISSIONS_LIST, () => permissions.list());
  handleTrusted(IPC_CHANNELS.PERMISSIONS_RESET, (_event, origin: unknown, key: unknown) =>
    permissions.reset(typeof origin === 'string' ? origin : undefined, typeof key === 'string' ? key : undefined)
  );
  return permissions;
}

/** Blocks the browser chrome from ever navigating away or opening windows. */
function lockDownChrome(window: BrowserWindow): void {
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

/**
 * Auto-update from GitHub Releases (configured in electron-builder.yml).
 * The updater only runs in installed (packaged, non-portable) builds.
 */
function setupUpdates(window: BrowserWindow): UpdateService {
  const service = new UpdateService({
    environment: {
      currentVersion: app.getVersion(),
      isPackaged: app.isPackaged,
      isPortable: Boolean(process.env.PORTABLE_EXECUTABLE_DIR)
    },
    createUpdater: () => {
      const updater = autoUpdaterModule.autoUpdater;
      updater.autoDownload = true;
      updater.autoInstallOnAppQuit = true;
      updater.logger = {
        info: (message: unknown) => logger.write('debug', 'updater', String(message)),
        warn: (message: unknown) => logger.write('warn', 'updater', String(message)),
        error: (message: unknown) => logger.write('warn', 'updater', String(message)),
        debug: () => undefined
      };
      return updater;
    },
    log: (level, message, data) => logger.write(level, 'update', message, data)
  });

  service.onChange(() => {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.UPDATE_CHANGED, service.getState());
    }
    if (service.getState().status === 'downloaded') {
      showDesktopNotification('StudyNest update ready', 'Restart StudyNest to finish installing the update.');
    }
  });

  handleTrusted(IPC_CHANNELS.UPDATE_STATE_REQUEST, () => service.getState());
  handleTrusted(IPC_CHANNELS.UPDATE_CHECK, () => service.check());
  handleTrusted(IPC_CHANNELS.UPDATE_INSTALL, () => service.installNow());
  service.start();
  return service;
}

function initializeApplication(): void {
  logger = new Logger({
    filePath: path.join(app.getPath('userData'), 'logs', 'studynest.log'),
    minLevel: process.env.VITE_DEV_SERVER_URL ? 'debug' : 'info',
    echo: Boolean(process.env.VITE_DEV_SERVER_URL)
  });
  logger.write('info', 'app', 'starting', { version: app.getVersion(), platform: process.platform });

  mainWindow = createMainWindow();
  setTrustedSender(mainWindow.webContents);
  lockDownChrome(mainWindow);
  setupSitePermissions(mainWindow);
  setupWindowControls(mainWindow);
  tabManager = new TabManager(mainWindow);
  setupBrowserIpc(mainWindow, tabManager);
  const appConfig = loadAppConfig(resourceDir('config'));
  const ai = setupPolicyAndClassification(mainWindow, appConfig);
  policyService = ai.policy;
  classificationClient = ai.client;
  studyService = setupStudyMode(mainWindow, tabManager, ai.policy, ai.client);
  ai.policy.startRefreshing(appConfig.policyRefreshHours);
  logger.write('info', 'app', 'study rules loaded', { source: ai.policy.getSnapshot().source, gateway: appConfig.gatewayUrl });
  accountService = setupProductServices(mainWindow, studyService, logger);
  setupResilience(mainWindow, tabManager);
  setupShortcuts(mainWindow, tabManager);
  setupDownloads(mainWindow);
  updateService = setupUpdates(mainWindow);
  const window = mainWindow;
  browserServices = setupBrowserServices({
    window,
    manager: tabManager,
    sendCommand: (command) => sendBrowserCommand(window, command),
    isStudyActive: () => studyService?.getSnapshot().session !== null,
    studyBlocksRequest: (requestUrl, pageUrl) => {
      if (!pageUrl || !policyService || studyService?.getSnapshot().session == null) return false;
      let pageHost: string | null = null;
      try {
        pageHost = new URL(pageUrl).hostname;
      } catch {
        return false;
      }
      return focusBlocksRequest(policyService.getPolicy().focus, pageHost, requestUrl);
    },
    log: (level, message, data) => logger.write(level, 'browser', message, data)
  });
  browserServices.restoreSession();
}

// One StudyNest window: opening it again (or clicking a link in another app
// when it is the default browser) opens a tab in the running window.
const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    const url = urlFromArgv(argv);
    tabManager?.createTab(url ?? NEW_TAB_URL, true);
  });
}

app.whenReady().then(() => {
  if (!hasInstanceLock) return;
  initializeApplication();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      initializeApplication();
    }
  });
});

app.on('before-quit', () => {
  studyService?.getSnapshot();
  studyStore?.flush();
  classificationClient?.flush();
  policyService?.stop();
  accountService?.dispose();
  updateService?.stop();
  browserServices?.flush();
  logger.write('info', 'app', 'quitting');
});

process.on('uncaughtException', (error) => {
  logger.write('error', 'process', 'uncaught exception', { error: error.stack ?? error.message });
});

process.on('unhandledRejection', (reason) => {
  logger.write('error', 'process', 'unhandled rejection', { error: reason instanceof Error ? (reason.stack ?? reason.message) : String(reason) });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
