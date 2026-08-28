export const IPC_CHANNELS = {
  STATE_REQUEST: 'browser:state-request',
  STATE_CHANGED: 'browser:state-changed',
  NEW_TAB: 'browser:new-tab',
  CLOSE_TAB: 'browser:close-tab',
  SWITCH_TAB: 'browser:switch-tab',
  NAVIGATE: 'browser:navigate',
  GO_BACK: 'browser:go-back',
  GO_FORWARD: 'browser:go-forward',
  REFRESH: 'browser:refresh',
  SET_CHROME_HEIGHT: 'browser:set-chrome-height',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_TOGGLE_MAXIMIZE: 'window:toggle-maximize',
  WINDOW_CLOSE: 'window:close'
} as const;

export const BROWSER_CHROME_HEIGHT = 220;

export type BrowserTabState = {
  id: string;
  title: string;
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
};

export type BrowserStateSnapshot = {
  tabs: BrowserTabState[];
  activeTabId: string | null;
};

export type NavigationPayload = {
  url: string;
  tabId?: string;
};

export type TabIdPayload = {
  tabId: string;
};

export type StudyNestApi = {
  getState(): Promise<BrowserStateSnapshot>;
  newTab(url?: string): Promise<BrowserStateSnapshot>;
  closeTab(tabId: string): Promise<BrowserStateSnapshot>;
  switchTab(tabId: string): Promise<BrowserStateSnapshot>;
  navigate(url: string, tabId?: string): Promise<BrowserStateSnapshot>;
  goBack(tabId?: string): Promise<BrowserStateSnapshot>;
  goForward(tabId?: string): Promise<BrowserStateSnapshot>;
  refresh(tabId?: string): Promise<BrowserStateSnapshot>;
  setChromeHeight(height: number): Promise<void>;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
};