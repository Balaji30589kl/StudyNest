import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER_CHROME_HEIGHT, BrowserStateSnapshot, IPC_CHANNELS } from '../shared/ipc.js';
import { normalizeNavigationInput } from '../shared/url.js';
import { TabManager } from './tab-manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let tabManager: TabManager | null = null;

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1400,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    backgroundColor: '#0b1020',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, '../preload/index.mjs')
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(path.resolve(__dirname, '../../dist/index.html'));
  }

  return window;
}

function setupWindowControls(window: BrowserWindow): void {
  ipcMain.handle(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
    window.minimize();
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE, () => {
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_CLOSE, () => {
    window.close();
  });
}

function setupBrowserIpc(window: BrowserWindow, manager: TabManager): void {
  ipcMain.handle(IPC_CHANNELS.STATE_REQUEST, () => manager.getSnapshot());
  ipcMain.handle(IPC_CHANNELS.NEW_TAB, (_event, inputUrl?: string) => manager.createTab(inputUrl));
  ipcMain.handle(IPC_CHANNELS.CLOSE_TAB, (_event, tabId: string) => manager.closeTab(tabId));
  ipcMain.handle(IPC_CHANNELS.SWITCH_TAB, (_event, tabId: string) => manager.switchTab(tabId));
  ipcMain.handle(IPC_CHANNELS.NAVIGATE, (_event, payload: { url: string; tabId?: string }) => {
    const resolvedUrl = normalizeNavigationInput(payload.url);
    return manager.navigate(resolvedUrl, payload.tabId);
  });
  ipcMain.handle(IPC_CHANNELS.GO_BACK, (_event, tabId?: string) => manager.goBack(tabId));
  ipcMain.handle(IPC_CHANNELS.GO_FORWARD, (_event, tabId?: string) => manager.goForward(tabId));
  ipcMain.handle(IPC_CHANNELS.REFRESH, (_event, tabId?: string) => manager.refresh(tabId));
  ipcMain.handle(IPC_CHANNELS.SET_CHROME_HEIGHT, (_event, height: number) => {
    manager.setChromeHeight(height);
  });

  window.on('resize', () => {
    manager.layoutActiveTab();
  });
}

function initializeApplication(): void {
  mainWindow = createMainWindow();
  setupWindowControls(mainWindow);
  tabManager = new TabManager(mainWindow);
  setupBrowserIpc(mainWindow, tabManager);
  tabManager.createTab('https://example.com', true);
}

app.whenReady().then(() => {
  initializeApplication();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      initializeApplication();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
