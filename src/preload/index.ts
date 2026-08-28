import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, StudyNestApi, BrowserStateSnapshot } from '../shared/ipc.js';

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
  minimize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE),
  toggleMaximize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE),
  close: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE)
};

contextBridge.exposeInMainWorld('studyNest', api);

ipcRenderer.on(IPC_CHANNELS.STATE_CHANGED, (_event, snapshot: BrowserStateSnapshot) => {
  window.dispatchEvent(new CustomEvent('studynest:state-changed', { detail: snapshot }));
});
