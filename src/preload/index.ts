import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, StudyNestApi } from '../shared/ipc.js';

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

const api: StudyNestApi = {
  getState: () => invoke(IPC_CHANNELS.STATE_REQUEST),
  newTab: (url?: string) => invoke(IPC_CHANNELS.NEW_TAB, url),
  closeTab: (tabId: string) => invoke(IPC_CHANNELS.CLOSE_TAB, tabId),
  switchTab: (tabId: string) => invoke(IPC_CHANNELS.SWITCH_TAB, tabId),
  navigate: (url: string, tabId?: string) => invoke(IPC_CHANNELS.NAVIGATE, { url, tabId }),
  goBack: (tabId?: string) => invoke(IPC_CHANNELS.GO_BACK, tabId),
  goForward: (tabId?: string) => invoke(IPC_CHANNELS.GO_FORWARD, tabId),
  refresh: (tabId?: string) => invoke(IPC_CHANNELS.REFRESH, tabId),
  stop: (tabId?: string) => invoke(IPC_CHANNELS.STOP, tabId),
  setChromeHeight: (height: number) => invoke(IPC_CHANNELS.SET_CHROME_HEIGHT, height),
  setContentInsetRight: (width: number) => invoke(IPC_CHANNELS.SET_CONTENT_INSET_RIGHT, width),
  capturePage: () => invoke(IPC_CHANNELS.CAPTURE_PAGE),
  setPageViewHidden: (hidden: boolean) => invoke(IPC_CHANNELS.SET_PAGE_VIEW_HIDDEN, hidden),
  tabAction: (action) => invoke(IPC_CHANNELS.TAB_ACTION, action),
  showTabMenu: (tabId) => invoke(IPC_CHANNELS.TAB_MENU, tabId),
  showAppMenu: (position) => invoke(IPC_CHANNELS.APP_MENU, position),
  showBookmarkMenu: (id) => invoke(IPC_CHANNELS.BOOKMARK_MENU, id),
  find: (text, options) => invoke(IPC_CHANNELS.FIND, text, options),
  stopFind: () => invoke(IPC_CHANNELS.FIND_STOP),
  print: () => invoke(IPC_CHANNELS.PRINT),
  zoom: (steps) => invoke(IPC_CHANNELS.ZOOM, steps),
  getSettings: () => invoke(IPC_CHANNELS.SETTINGS_REQUEST),
  updateSettings: (changes) => invoke(IPC_CHANNELS.SETTINGS_UPDATE, changes),
  queryHistory: (options) => invoke(IPC_CHANNELS.HISTORY_QUERY, options),
  suggestHistory: (text) => invoke(IPC_CHANNELS.HISTORY_SUGGEST, text),
  getTopSites: () => invoke(IPC_CHANNELS.HISTORY_TOP_SITES),
  deleteHistory: (ids) => invoke(IPC_CHANNELS.HISTORY_DELETE, ids),
  getBookmarks: () => invoke(IPC_CHANNELS.BOOKMARKS_REQUEST),
  toggleBookmark: (url, title) => invoke(IPC_CHANNELS.BOOKMARKS_TOGGLE, url, title),
  removeBookmark: (id) => invoke(IPC_CHANNELS.BOOKMARKS_REMOVE, id),
  updateBookmark: (id, changes) => invoke(IPC_CHANNELS.BOOKMARKS_UPDATE, id, changes),
  moveBookmark: (id, index) => invoke(IPC_CHANNELS.BOOKMARKS_MOVE, id, index),
  clearBrowsingData: (options) => invoke(IPC_CHANNELS.CLEAR_BROWSING_DATA, options),
  getAdBlockState: () => invoke(IPC_CHANNELS.ADBLOCK_STATE_REQUEST),
  getDefaultBrowserState: () => invoke(IPC_CHANNELS.DEFAULT_BROWSER_REQUEST),
  setDefaultBrowser: () => invoke(IPC_CHANNELS.DEFAULT_BROWSER_SET),
  getStudyState: () => invoke(IPC_CHANNELS.STUDY_STATE_REQUEST),
  startStudySession: (durationMinutes: number | null) => invoke(IPC_CHANNELS.STUDY_START, durationMinutes),
  stopStudySession: () => invoke(IPC_CHANNELS.STUDY_STOP),
  updateStudySettings: (settings) => invoke(IPC_CHANNELS.STUDY_UPDATE_SETTINGS, settings),
  clearStudyHistory: () => invoke(IPC_CHANNELS.STUDY_CLEAR_HISTORY),
  getAiState: () => invoke(IPC_CHANNELS.AI_STATE_REQUEST),
  clearAiCache: () => invoke(IPC_CHANNELS.AI_CLEAR_CACHE),
  getInsights: () => invoke(IPC_CHANNELS.INSIGHTS_REQUEST),
  getAccountState: () => invoke(IPC_CHANNELS.ACCOUNT_STATE_REQUEST),
  updateProfile: (profile) => invoke(IPC_CHANNELS.ACCOUNT_UPDATE_PROFILE, profile),
  chooseSyncFolder: () => invoke(IPC_CHANNELS.SYNC_CHOOSE_FOLDER),
  configureSync: (config) => invoke(IPC_CHANNELS.SYNC_CONFIGURE, config),
  syncNow: () => invoke(IPC_CHANNELS.SYNC_NOW),
  getDiagnostics: () => invoke(IPC_CHANNELS.DIAGNOSTICS_REQUEST),
  getDownloads: () => invoke(IPC_CHANNELS.DOWNLOADS_STATE_REQUEST),
  openDownload: (id: string) => invoke(IPC_CHANNELS.DOWNLOADS_OPEN, id),
  showDownload: (id: string) => invoke(IPC_CHANNELS.DOWNLOADS_SHOW, id),
  cancelDownload: (id: string) => invoke(IPC_CHANNELS.DOWNLOADS_CANCEL, id),
  clearDownloads: () => invoke(IPC_CHANNELS.DOWNLOADS_CLEAR),
  getSitePermissions: () => invoke(IPC_CHANNELS.PERMISSIONS_LIST),
  resetSitePermissions: (origin?: string, key?: string) => invoke(IPC_CHANNELS.PERMISSIONS_RESET, origin, key),
  getUpdateState: () => invoke(IPC_CHANNELS.UPDATE_STATE_REQUEST),
  checkForUpdates: () => invoke(IPC_CHANNELS.UPDATE_CHECK),
  installUpdate: () => invoke(IPC_CHANNELS.UPDATE_INSTALL),
  minimize: () => invoke(IPC_CHANNELS.WINDOW_MINIMIZE),
  toggleMaximize: () => invoke(IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE),
  close: () => invoke(IPC_CHANNELS.WINDOW_CLOSE)
};

contextBridge.exposeInMainWorld('studyNest', api);

/** Main-process pushes become DOM events the React app listens to. */
const EVENTS: Array<[string, string]> = [
  [IPC_CHANNELS.STATE_CHANGED, 'studynest:state-changed'],
  [IPC_CHANNELS.STUDY_STATE_CHANGED, 'studynest:study-changed'],
  [IPC_CHANNELS.AI_STATE_CHANGED, 'studynest:ai-changed'],
  [IPC_CHANNELS.ACCOUNT_STATE_CHANGED, 'studynest:account-changed'],
  [IPC_CHANNELS.BROWSER_COMMAND, 'studynest:command'],
  [IPC_CHANNELS.DOWNLOADS_CHANGED, 'studynest:downloads-changed'],
  [IPC_CHANNELS.UPDATE_CHANGED, 'studynest:update-changed'],
  [IPC_CHANNELS.SETTINGS_CHANGED, 'studynest:settings-changed'],
  [IPC_CHANNELS.BOOKMARKS_CHANGED, 'studynest:bookmarks-changed'],
  [IPC_CHANNELS.HISTORY_CHANGED, 'studynest:history-changed'],
  [IPC_CHANNELS.FIND_RESULT, 'studynest:find-result'],
  [IPC_CHANNELS.ADBLOCK_CHANGED, 'studynest:adblock-changed']
];

for (const [channel, eventName] of EVENTS) {
  ipcRenderer.on(channel, (_event, detail: unknown) => {
    window.dispatchEvent(new CustomEvent(eventName, { detail }));
  });
}
