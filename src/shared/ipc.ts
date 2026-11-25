import type { BrowserSettings } from './browser-settings.js';
import type { Classification, PageCategory } from './classification.js';
import type { InsightsSnapshot } from './insights.js';
import type { PolicyReason, StudySettings } from './study-policy.js';

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
  SET_CONTENT_INSET_RIGHT: 'browser:set-content-inset-right',
  CAPTURE_PAGE: 'browser:capture-page',
  SET_PAGE_VIEW_HIDDEN: 'browser:set-page-view-hidden',
  STUDY_STATE_REQUEST: 'study:state-request',
  STUDY_STATE_CHANGED: 'study:state-changed',
  STUDY_START: 'study:start',
  STUDY_STOP: 'study:stop',
  STUDY_UPDATE_SETTINGS: 'study:update-settings',
  STUDY_CLEAR_HISTORY: 'study:clear-history',
  AI_STATE_REQUEST: 'ai:state-request',
  AI_STATE_CHANGED: 'ai:state-changed',
  AI_CLEAR_CACHE: 'ai:clear-cache',
  POLICY_STATE_REQUEST: 'policy:state-request',
  INSIGHTS_REQUEST: 'insights:request',
  ACCOUNT_STATE_REQUEST: 'account:state-request',
  ACCOUNT_STATE_CHANGED: 'account:state-changed',
  ACCOUNT_UPDATE_PROFILE: 'account:update-profile',
  SYNC_CHOOSE_FOLDER: 'sync:choose-folder',
  SYNC_CONFIGURE: 'sync:configure',
  SYNC_NOW: 'sync:now',
  DIAGNOSTICS_REQUEST: 'app:diagnostics',
  BROWSER_COMMAND: 'browser:command',
  DOWNLOADS_STATE_REQUEST: 'downloads:state-request',
  DOWNLOADS_CHANGED: 'downloads:changed',
  DOWNLOADS_OPEN: 'downloads:open',
  DOWNLOADS_SHOW: 'downloads:show',
  DOWNLOADS_CANCEL: 'downloads:cancel',
  DOWNLOADS_CLEAR: 'downloads:clear',
  PERMISSIONS_LIST: 'permissions:list',
  PERMISSIONS_RESET: 'permissions:reset',
  UPDATE_STATE_REQUEST: 'update:state-request',
  UPDATE_CHANGED: 'update:changed',
  UPDATE_CHECK: 'update:check',
  UPDATE_INSTALL: 'update:install',
  STOP: 'browser:stop',
  TAB_ACTION: 'browser:tab-action',
  TAB_MENU: 'browser:tab-menu',
  APP_MENU: 'browser:app-menu',
  FIND: 'browser:find',
  FIND_STOP: 'browser:find-stop',
  FIND_RESULT: 'browser:find-result',
  PRINT: 'browser:print',
  ZOOM: 'browser:zoom',
  SETTINGS_REQUEST: 'settings:request',
  SETTINGS_CHANGED: 'settings:changed',
  SETTINGS_UPDATE: 'settings:update',
  HISTORY_QUERY: 'history:query',
  HISTORY_SUGGEST: 'history:suggest',
  HISTORY_TOP_SITES: 'history:top-sites',
  HISTORY_DELETE: 'history:delete',
  HISTORY_CHANGED: 'history:changed',
  BOOKMARKS_REQUEST: 'bookmarks:request',
  BOOKMARKS_CHANGED: 'bookmarks:changed',
  BOOKMARKS_TOGGLE: 'bookmarks:toggle',
  BOOKMARKS_REMOVE: 'bookmarks:remove',
  BOOKMARKS_UPDATE: 'bookmarks:update',
  BOOKMARKS_MOVE: 'bookmarks:move',
  BOOKMARK_MENU: 'bookmarks:menu',
  CLEAR_BROWSING_DATA: 'privacy:clear-data',
  ADBLOCK_STATE_REQUEST: 'adblock:state-request',
  ADBLOCK_CHANGED: 'adblock:changed',
  DEFAULT_BROWSER_REQUEST: 'default-browser:request',
  DEFAULT_BROWSER_SET: 'default-browser:set',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_TOGGLE_MAXIMIZE: 'window:toggle-maximize',
  WINDOW_CLOSE: 'window:close'
} as const;

/** Height reserved for the browser chrome before the renderer reports its real height. */
export const BROWSER_CHROME_HEIGHT = 84;

export type BrowserTabState = {
  id: string;
  title: string;
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  /** Present when the main process replaced this tab's page with a block page. */
  blocked: BlockedNavigationInfo | null;
  /** True while Study Mode checks this tab's page before showing it. */
  checking: boolean;
  /** Site icon URL from the page, when it provided one. */
  favicon: string | null;
  /** Playing sound right now, and whether the user muted the tab. */
  audible: boolean;
  muted: boolean;
  pinned: boolean;
  /** Page zoom in percent (100 = default). */
  zoomPercent: number;
  /** Ads and trackers blocked on the current page. */
  blockedAds: number;
};

export type BlockedNavigationInfo = {
  url: string;
  host: string;
  action: 'block';
  reason: PolicyReason;
  classification?: Pick<Classification, 'category' | 'confidence' | 'providerId'>;
};

/** Still image of the active page, used to show overlays above where the native page view sits. */
export type PageSnapshot = {
  dataUrl: string;
  bounds: { x: number; y: number; width: number; height: number };
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

export type StudyEventType =
  | 'session-start'
  | 'session-end'
  | 'visit'
  | 'blocked'
  | 'focus-lost'
  | 'focus-regained'
  | 'classified';

export type StudyEvent = {
  id: string;
  type: StudyEventType;
  at: number;
  sessionId: string | null;
  host?: string;
  url?: string;
  detail?: string;
};

export type StudySessionStats = {
  focusedMs: number;
  awayMs: number;
  focusLosses: number;
  /** All blocked page loads (by list or by AI). */
  blockedCount: number;
  blockedByList: number;
  blockedByAi: number;
  /** Pages checked by AI during the session, and how many of those were allowed. */
  aiChecks: number;
  aiAllowed: number;
  pagesVisited: number;
  /** Foreground time per host while the window was focused. */
  hostMs: Record<string, number>;
  /** Blocked page loads per host. */
  blockedHosts: Record<string, number>;
  /** AI verdicts per category. */
  categoryCounts: Partial<Record<PageCategory, number>>;
};

export type StudySessionState = {
  id: string;
  startedAt: number;
  /** Null for an open-ended session (Study Mode switched on without a timer). */
  endsAt: number | null;
  durationMinutes: number | null;
};

export type StudySessionSummary = StudySessionState & {
  endedAt: number;
  endReason: 'completed' | 'stopped';
  stats: StudySessionStats;
};

export type StudyStateSnapshot = {
  settings: StudySettings;
  policy: PolicySnapshot;
  session: StudySessionState | null;
  /** Live stats for the running session, or the last finished session. */
  stats: StudySessionStats | null;
  recentEvents: StudyEvent[];
  recentSessions: StudySessionSummary[];
};

/** Where the Study Mode rules came from. Users can't edit them. */
export type PolicySnapshot = {
  source: 'gateway' | 'gateway-cache' | 'bundled' | 'built-in' | 'override';
  version: string | null;
  updatedAt: number | null;
  blockRules: number;
  allowRules: number;
  aiEnabled: boolean;
  lastError: string | null;
};

export type AiStats = {
  checks: number;
  cacheHits: number;
  gatewayCalls: number;
  fallbacks: number;
  errors: number;
  lastError: string | null;
};

export type AiStateSnapshot = {
  gateway: { url: string; status: 'online' | 'offline' | 'unknown' };
  stats: AiStats;
  cacheSize: number;
  recentClassifications: Classification[];
};

export type AccountStateSnapshot = {
  profile: { id: string; displayName: string; createdAt: number };
  device: { id: string; name: string };
  sync: {
    folder: string | null;
    includeBrowsingDetails: boolean;
    lastSyncAt: number | null;
    lastError: string | null;
    syncing: boolean;
  };
};

export type DiagnosticsSnapshot = {
  appVersion: string;
  electronVersion: string;
  chromeVersion: string;
  platform: string;
  dataDirectory: string;
  logFile: string;
  uptimeMs: number;
  recentProblems: Array<{ at: number; level: string; message: string }>;
};

/** Commands main asks the renderer to perform (keyboard shortcuts and menu items that need renderer state). */
export type BrowserCommand =
  | { type: 'new-tab' }
  | { type: 'focus-address' }
  | { type: 'find' }
  | { type: 'open-panel'; panel: 'study' | 'insights' | 'downloads' };

export type TabAction =
  | { type: 'mute'; tabId: string }
  | { type: 'pin'; tabId: string }
  | { type: 'duplicate'; tabId: string }
  | { type: 'reload'; tabId: string }
  | { type: 'close-others'; tabId: string }
  | { type: 'close-right'; tabId: string }
  | { type: 'move'; tabId: string; index: number };

export type FindResult = { tabId: string; activeMatch: number; matches: number; finalUpdate: boolean };

export type HistoryEntry = { id: string; url: string; title: string; host: string; visitedAt: number };
export type HistorySuggestion = { url: string; title: string; visits: number; lastVisitedAt: number };
export type TopSite = { url: string; host: string; title: string; visits: number };
export type Bookmark = { id: string; url: string; title: string; createdAt: number };

export type ClearDataOptions = {
  /** Only data since this time; 0 clears everything. */
  since: number;
  history: boolean;
  cookies: boolean;
  cache: boolean;
};

export type AdBlockState = {
  /** False until the filter lists are loaded (first run downloads them). */
  ready: boolean;
  error: string | null;
  totalBlocked: number;
};

export type DefaultBrowserState = { isDefault: boolean; canSet: boolean };

export type DownloadEntry = {
  id: string;
  filename: string;
  host: string;
  receivedBytes: number;
  totalBytes: number;
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted';
  savePath: string | null;
  startedAt: number;
};

export type SitePermission = { origin: string; key: string; decision: 'allow' | 'deny'; decidedAt: number };

export type UpdateState = {
  status: 'disabled' | 'idle' | 'checking' | 'up-to-date' | 'downloading' | 'downloaded' | 'error';
  currentVersion: string;
  availableVersion?: string;
  percent?: number;
  lastCheckedAt?: number;
  /** Why updates are disabled, or a friendly error. */
  message?: string;
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
  setContentInsetRight(width: number): Promise<void>;
  capturePage(): Promise<PageSnapshot | null>;
  setPageViewHidden(hidden: boolean): Promise<void>;
  getStudyState(): Promise<StudyStateSnapshot>;
  /** Pass minutes for a timed session, or null to switch Study Mode on without a timer. */
  startStudySession(durationMinutes: number | null): Promise<StudyStateSnapshot>;
  stopStudySession(): Promise<StudyStateSnapshot>;
  updateStudySettings(settings: Partial<StudySettings>): Promise<StudyStateSnapshot>;
  clearStudyHistory(): Promise<StudyStateSnapshot>;
  getAiState(): Promise<AiStateSnapshot>;
  clearAiCache(): Promise<AiStateSnapshot>;
  getInsights(): Promise<InsightsSnapshot>;
  getAccountState(): Promise<AccountStateSnapshot>;
  updateProfile(profile: { displayName?: string; deviceName?: string }): Promise<AccountStateSnapshot>;
  /** Opens a native folder picker in main; the renderer never touches the file system. */
  chooseSyncFolder(): Promise<AccountStateSnapshot>;
  configureSync(config: { folder?: null; includeBrowsingDetails?: boolean }): Promise<AccountStateSnapshot>;
  syncNow(): Promise<AccountStateSnapshot>;
  getDiagnostics(): Promise<DiagnosticsSnapshot>;
  getDownloads(): Promise<DownloadEntry[]>;
  openDownload(id: string): Promise<void>;
  showDownload(id: string): Promise<void>;
  cancelDownload(id: string): Promise<void>;
  clearDownloads(): Promise<DownloadEntry[]>;
  getSitePermissions(): Promise<SitePermission[]>;
  /** No origin resets everything; origin alone resets that site; origin + key resets one decision. */
  resetSitePermissions(origin?: string, key?: string): Promise<SitePermission[]>;
  getUpdateState(): Promise<UpdateState>;
  checkForUpdates(): Promise<UpdateState>;
  installUpdate(): Promise<void>;
  stop(tabId?: string): Promise<void>;
  tabAction(action: TabAction): Promise<BrowserStateSnapshot>;
  /** Native context menus, drawn by the OS above the page. */
  showTabMenu(tabId: string): Promise<void>;
  showAppMenu(position: { x: number; y: number }): Promise<void>;
  showBookmarkMenu(id: string): Promise<void>;
  find(text: string, options: { forward: boolean; findNext: boolean }): Promise<void>;
  stopFind(): Promise<void>;
  print(): Promise<void>;
  zoom(steps: number): Promise<void>;
  getSettings(): Promise<BrowserSettings>;
  updateSettings(changes: Partial<BrowserSettings>): Promise<BrowserSettings>;
  queryHistory(options: { text?: string; limit?: number; before?: number }): Promise<HistoryEntry[]>;
  suggestHistory(text: string): Promise<HistorySuggestion[]>;
  getTopSites(): Promise<TopSite[]>;
  deleteHistory(ids: string[]): Promise<void>;
  getBookmarks(): Promise<Bookmark[]>;
  toggleBookmark(url: string, title: string): Promise<Bookmark[]>;
  removeBookmark(id: string): Promise<Bookmark[]>;
  updateBookmark(id: string, changes: { title?: string; url?: string }): Promise<Bookmark[]>;
  moveBookmark(id: string, index: number): Promise<Bookmark[]>;
  clearBrowsingData(options: ClearDataOptions): Promise<void>;
  getAdBlockState(): Promise<AdBlockState>;
  getDefaultBrowserState(): Promise<DefaultBrowserState>;
  setDefaultBrowser(): Promise<DefaultBrowserState>;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
};