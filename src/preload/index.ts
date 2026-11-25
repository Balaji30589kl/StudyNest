import { contextBridge, ipcRenderer } from 'electron';
import { AccountStateSnapshot, AiStateSnapshot, IPC_CHANNELS, StudyNestApi, BrowserStateSnapshot, StudyStateSnapshot } from '../shared/ipc.js';

const api: StudyNestApi = {
  getState: () => ipcRenderer.invoke(IPC_CHANNELS.STATE_REQUEST),
  newTab: (url?: string) => ipcRenderer.invoke(IPC_CHANNELS.NEW_TAB, url),
  closeTab: (tabId: string) => ipcRenderer.invoke(IPC_CHANNELS.CLOSE_TAB, tabId),
  switchTab: (tabId: string) => ipcRenderer.invoke(IPC_CHANNELS.SWITCH_TAB, tabId),
  navigate: (url: string, tabId?: string) => ipcRenderer.invoke(IPC_CHANNELS.NAVIGATE, { url, tabId }),
  goBack: (tabId?: string) => ipcRenderer.invoke(IPC_CHANNELS.GO_BACK, tabId),
  goForward: (tabId?: string) => ipcRenderer.invoke(IPC_CHANNELS.GO_FORWARD, tabId),
  refresh: (tabId?: string) => ipcRenderer.invoke(IPC_CHANNELS.REFRESH, tabId),
  setChromeHeight: (height: number) => ipcRenderer.invoke(IPC_CHANNELS.SET_CHROME_HEIGHT, height),
  setContentInsetRight: (width: number) => ipcRenderer.invoke(IPC_CHANNELS.SET_CONTENT_INSET_RIGHT, width),
  capturePage: () => ipcRenderer.invoke(IPC_CHANNELS.CAPTURE_PAGE),
  setPageViewHidden: (hidden: boolean) => ipcRenderer.invoke(IPC_CHANNELS.SET_PAGE_VIEW_HIDDEN, hidden),
  getStudyState: () => ipcRenderer.invoke(IPC_CHANNELS.STUDY_STATE_REQUEST),
  startStudySession: (durationMinutes: number | null) => ipcRenderer.invoke(IPC_CHANNELS.STUDY_START, durationMinutes),
  stopStudySession: () => ipcRenderer.invoke(IPC_CHANNELS.STUDY_STOP),
  updateStudySettings: (settings) => ipcRenderer.invoke(IPC_CHANNELS.STUDY_UPDATE_SETTINGS, settings),
  clearStudyHistory: () => ipcRenderer.invoke(IPC_CHANNELS.STUDY_CLEAR_HISTORY),
  getAiState: () => ipcRenderer.invoke(IPC_CHANNELS.AI_STATE_REQUEST),
  clearAiCache: () => ipcRenderer.invoke(IPC_CHANNELS.AI_CLEAR_CACHE),
  getInsights: () => ipcRenderer.invoke(IPC_CHANNELS.INSIGHTS_REQUEST),
  getAccountState: () => ipcRenderer.invoke(IPC_CHANNELS.ACCOUNT_STATE_REQUEST),
  updateProfile: (profile) => ipcRenderer.invoke(IPC_CHANNELS.ACCOUNT_UPDATE_PROFILE, profile),
  chooseSyncFolder: () => ipcRenderer.invoke(IPC_CHANNELS.SYNC_CHOOSE_FOLDER),
  configureSync: (config) => ipcRenderer.invoke(IPC_CHANNELS.SYNC_CONFIGURE, config),
  syncNow: () => ipcRenderer.invoke(IPC_CHANNELS.SYNC_NOW),
  getDiagnostics: () => ipcRenderer.invoke(IPC_CHANNELS.DIAGNOSTICS_REQUEST),
  getDownloads: () => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_STATE_REQUEST),
  openDownload: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_OPEN, id),
  showDownload: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_SHOW, id),
  cancelDownload: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_CANCEL, id),
  clearDownloads: () => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_CLEAR),
  getSitePermissions: () => ipcRenderer.invoke(IPC_CHANNELS.PERMISSIONS_LIST),
  resetSitePermissions: (origin?: string, key?: string) => ipcRenderer.invoke(IPC_CHANNELS.PERMISSIONS_RESET, origin, key),
  getUpdateState: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_STATE_REQUEST),
  checkForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_CHECK),
  installUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_INSTALL),
  minimize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE),
  toggleMaximize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE),
  close: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE)
};

contextBridge.exposeInMainWorld('studyNest', api);

ipcRenderer.on(IPC_CHANNELS.STATE_CHANGED, (_event, snapshot: BrowserStateSnapshot) => {
  window.dispatchEvent(new CustomEvent('studynest:state-changed', { detail: snapshot }));
});

ipcRenderer.on(IPC_CHANNELS.STUDY_STATE_CHANGED, (_event, snapshot: StudyStateSnapshot) => {
  window.dispatchEvent(new CustomEvent('studynest:study-changed', { detail: snapshot }));
});

ipcRenderer.on(IPC_CHANNELS.AI_STATE_CHANGED, (_event, snapshot: AiStateSnapshot) => {
  window.dispatchEvent(new CustomEvent('studynest:ai-changed', { detail: snapshot }));
});

ipcRenderer.on(IPC_CHANNELS.ACCOUNT_STATE_CHANGED, (_event, snapshot: AccountStateSnapshot) => {
  window.dispatchEvent(new CustomEvent('studynest:account-changed', { detail: snapshot }));
});

ipcRenderer.on(IPC_CHANNELS.BROWSER_COMMAND, (_event, command: unknown) => {
  window.dispatchEvent(new CustomEvent('studynest:command', { detail: command }));
});

ipcRenderer.on(IPC_CHANNELS.DOWNLOADS_CHANGED, (_event, downloads: unknown) => {
  window.dispatchEvent(new CustomEvent('studynest:downloads-changed', { detail: downloads }));
});

ipcRenderer.on(IPC_CHANNELS.UPDATE_CHANGED, (_event, state: unknown) => {
  window.dispatchEvent(new CustomEvent('studynest:update-changed', { detail: state }));
});
