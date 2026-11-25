import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BrowserSettings, DEFAULT_BROWSER_SETTINGS } from '../../shared/browser-settings.js';
import type { InsightsSnapshot } from '../../shared/insights.js';
import type {
  AccountStateSnapshot,
  AdBlockState,
  AiStateSnapshot,
  Bookmark,
  BrowserCommand,
  BrowserStateSnapshot,
  DiagnosticsSnapshot,
  DownloadEntry,
  FindResult,
  PageSnapshot,
  SitePermission,
  StudyStateSnapshot,
  UpdateState
} from '../../shared/ipc.js';
import { internalPageOf, internalSectionOf } from '../../shared/internal-pages.js';
import { BookmarksBar } from './components/BookmarksBar.js';
import { bridge } from './components/common.js';
import { FindBar } from './components/FindBar.js';
import { TabStrip } from './components/TabStrip.js';
import { Toolbar } from './components/Toolbar.js';
import { DownloadsPanel } from './DownloadsPanel.js';
import { InsightsPanel } from './InsightsPanel.js';
import { BookmarksPage } from './pages/BookmarksPage.js';
import { HistoryPage } from './pages/HistoryPage.js';
import { NewTabPage } from './pages/NewTabPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { StudyPanel } from './StudyPanel.js';

type SidePanel = 'study' | 'insights' | 'downloads' | null;
type Toast = { id: number; message: string; action?: { label: string; run: () => void } };

const SIDE_PANEL_WIDTH = 380;

/** Subscribes to a main-process push forwarded by the preload as a DOM event. */
function useBridgeEvent<T>(name: string, handler: (detail: T) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const listener = (event: Event) => ref.current((event as CustomEvent<T>).detail);
    window.addEventListener(name, listener);
    return () => window.removeEventListener(name, listener);
  }, [name]);
}

export function App() {
  const [browserState, setBrowserState] = useState<BrowserStateSnapshot>({ tabs: [], activeTabId: null });
  const [settings, setSettings] = useState<BrowserSettings>(DEFAULT_BROWSER_SETTINGS);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [activePanel, setActivePanel] = useState<SidePanel>(null);
  const [studyState, setStudyState] = useState<StudyStateSnapshot | null>(null);
  const [aiState, setAiState] = useState<AiStateSnapshot | null>(null);
  const [insights, setInsights] = useState<InsightsSnapshot | null>(null);
  const [account, setAccount] = useState<AccountStateSnapshot | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot | null>(null);
  const [downloads, setDownloads] = useState<DownloadEntry[]>([]);
  const [sitePermissions, setSitePermissions] = useState<SitePermission[]>([]);
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);
  const [adBlock, setAdBlock] = useState<AdBlockState | null>(null);
  const [pageSnapshot, setPageSnapshot] = useState<PageSnapshot | null>(null);
  const [omniboxOpen, setOmniboxOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findFocus, setFindFocus] = useState(0);
  const [findResult, setFindResult] = useState<FindResult | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const chromeRef = useRef<HTMLElement | null>(null);
  const addressInputRef = useRef<HTMLInputElement | null>(null);

  const activeTab = useMemo(() => browserState.tabs.find((tab) => tab.id === browserState.activeTabId), [browserState]);
  const activePage = activeTab ? internalPageOf(activeTab.url) : null;
  const studySession = studyState?.session ?? null;
  const activeDownloads = downloads.filter((entry) => entry.state === 'progressing').length;

  const showToast = (message: string, action?: Toast['action']) => setToast({ id: Date.now(), message, action });

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), toast.action ? 6000 : 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Initial state ----------------------------------------------------------------
  useEffect(() => {
    if (!bridge) return;
    void bridge.getState().then(setBrowserState);
    void bridge.getSettings().then(setSettings);
    void bridge.getBookmarks().then(setBookmarks);
    void bridge.getStudyState().then(setStudyState);
    void bridge.getAiState().then(setAiState);
    void bridge.getAccountState().then(setAccount);
    void bridge.getDownloads().then(setDownloads);
    void bridge.getUpdateState().then(setUpdateState);
    void bridge.getAdBlockState().then(setAdBlock);
  }, []);

  useBridgeEvent<BrowserStateSnapshot>('studynest:state-changed', setBrowserState);
  useBridgeEvent<BrowserSettings>('studynest:settings-changed', setSettings);
  useBridgeEvent<Bookmark[]>('studynest:bookmarks-changed', setBookmarks);
  useBridgeEvent<StudyStateSnapshot>('studynest:study-changed', setStudyState);
  useBridgeEvent<AiStateSnapshot>('studynest:ai-changed', setAiState);
  useBridgeEvent<AccountStateSnapshot>('studynest:account-changed', setAccount);
  useBridgeEvent<UpdateState>('studynest:update-changed', setUpdateState);
  useBridgeEvent<AdBlockState>('studynest:adblock-changed', setAdBlock);
  useBridgeEvent<FindResult>('studynest:find-result', (result) => {
    if (result.tabId === browserState.activeTabId) setFindResult(result);
  });
  useBridgeEvent<DownloadEntry[]>('studynest:downloads-changed', (entries) => {
    setDownloads((previous) => {
      // Show the panel when a new download starts.
      if (entries.some((entry) => !previous.some((old) => old.id === entry.id))) setActivePanel('downloads');
      return entries;
    });
  });

  const focusAddress = () => {
    const input = addressInputRef.current;
    if (input) {
      input.focus();
      input.select();
    }
  };

  const openFind = () => {
    if (!activeTab || activePage || activeTab.blocked) return;
    setFindOpen(true);
    setFindFocus((value) => value + 1);
  };

  useBridgeEvent<BrowserCommand>('studynest:command', (command) => {
    switch (command?.type) {
      case 'focus-address':
        focusAddress();
        break;
      case 'new-tab':
        void bridge?.newTab().then(() => requestAnimationFrame(focusAddress));
        break;
      case 'find':
        openFind();
        break;
      case 'open-panel':
        setActivePanel((current) => (current === command.panel ? null : command.panel));
        break;
    }
  });

  // Theme: "system" follows Windows through prefers-color-scheme.
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = settings.theme;
  }, [settings.theme]);

  // The page view starts where the chrome ends; report its real height.
  useLayoutEffect(() => {
    const element = chromeRef.current;
    if (!element) return;
    const report = () => {
      const height = Math.ceil(element.getBoundingClientRect().height);
      document.documentElement.style.setProperty('--chrome-height', `${height}px`);
      void bridge?.setChromeHeight(height);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The page view is a native layer above this window, so main makes room for side panels.
  useEffect(() => {
    void bridge?.setContentInsetRight(activePanel ? SIDE_PANEL_WIDTH : 0);
  }, [activePanel]);

  // While the address-bar dropdown is open over a web page, show a still image of
  // the page and hide the live view, so the dropdown is not drawn underneath it.
  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    if (omniboxOpen && !activePage) {
      void bridge.capturePage().then((snapshot) => {
        if (cancelled) return;
        setPageSnapshot(snapshot);
        requestAnimationFrame(() => {
          if (!cancelled) void bridge?.setPageViewHidden(true);
        });
      });
    } else {
      void bridge.setPageViewHidden(false).then(() =>
        requestAnimationFrame(() => {
          if (!cancelled) setPageSnapshot(null);
        })
      );
    }
    return () => {
      cancelled = true;
    };
  }, [omniboxOpen, activePage]);

  // Close the find bar when the page it searches goes away.
  useEffect(() => {
    if (findOpen) {
      setFindOpen(false);
      setFindResult(null);
      void bridge?.stopFind();
    }
  }, [browserState.activeTabId, activeTab?.url]);

  // Clock for the study timer.
  useEffect(() => {
    setNow(Date.now());
    if (!studySession) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [studySession?.id]);

  // Live session stats while the Study panel is open.
  useEffect(() => {
    if (!bridge || activePanel !== 'study' || !studySession) return;
    const id = window.setInterval(() => void bridge?.getStudyState().then(setStudyState), 15000);
    return () => window.clearInterval(id);
  }, [activePanel, studySession?.id]);

  const latestSessionId = studyState?.recentSessions[0]?.id;
  useEffect(() => {
    if (bridge && activePanel === 'insights') void bridge.getInsights().then(setInsights);
  }, [activePanel, latestSessionId, studyState?.recentSessions.length]);

  useEffect(() => {
    if (bridge && activePage === 'settings') {
      void bridge.getDiagnostics().then(setDiagnostics);
      void bridge.getSitePermissions().then(setSitePermissions);
      void bridge.getAdBlockState().then(setAdBlock);
    }
  }, [activePage]);

  const startStudy = async (minutes: number | null) => {
    if (bridge) setStudyState(await bridge.startStudySession(minutes));
  };
  const stopStudy = async () => {
    if (bridge) setStudyState(await bridge.stopStudySession());
  };

  const toggleBookmark = async () => {
    if (!bridge || !activeTab) return;
    const url = activeTab.blocked?.url ?? activeTab.url;
    const wasBookmarked = bookmarks.some((bookmark) => bookmark.url === url);
    const next = await bridge.toggleBookmark(url, activeTab.title);
    setBookmarks(next);
    if (wasBookmarked) {
      showToast('Bookmark removed', { label: 'Undo', run: () => void bridge?.toggleBookmark(url, activeTab.title) });
    } else {
      const added = next.find((bookmark) => bookmark.url === url);
      showToast('Bookmark added', added ? { label: 'Edit', run: () => void bridge?.newTab(`studynest://bookmarks#edit=${added.id}`) } : undefined);
    }
  };

  const section = activeTab ? internalSectionOf(activeTab.url) : null;

  return (
    <div className="app-shell">
      <header ref={chromeRef} className={studySession ? 'chrome studying' : 'chrome'}>
        <TabStrip tabs={browserState.tabs} activeTabId={browserState.activeTabId} onNewTab={() => void bridge?.newTab().then(() => requestAnimationFrame(focusAddress))} />
        <Toolbar
          activeTab={activeTab}
          tabs={browserState.tabs}
          activeTabId={browserState.activeTabId}
          bookmarks={bookmarks}
          settings={settings}
          addressInputRef={addressInputRef}
          studySession={studySession}
          aiOffline={aiState?.gateway.status === 'offline'}
          now={now}
          activePanel={activePanel}
          downloadsVisible={downloads.length > 0}
          activeDownloads={activeDownloads}
          onEditingChange={setOmniboxOpen}
          onToggleBookmark={() => void toggleBookmark()}
          onToggleStudy={() => void (studySession ? stopStudy() : startStudy(null))}
          onTogglePanel={(panel) => setActivePanel((current) => (current === panel ? null : panel))}
        />
        {settings.showBookmarksBar ? <BookmarksBar bookmarks={bookmarks} activeTabId={browserState.activeTabId} /> : null}
        {findOpen ? (
          <FindBar
            result={findResult}
            focusToken={findFocus}
            onClose={() => {
              setFindOpen(false);
              setFindResult(null);
            }}
          />
        ) : null}
      </header>

      {pageSnapshot ? (
        <img
          className="page-snapshot"
          src={pageSnapshot.dataUrl}
          alt=""
          aria-hidden="true"
          style={{ left: pageSnapshot.bounds.x, top: pageSnapshot.bounds.y, width: pageSnapshot.bounds.width, height: pageSnapshot.bounds.height }}
        />
      ) : null}

      <main className={activePanel ? 'content with-panel' : 'content'}>
        {!bridge ? <div className="bridge-warning">Open this app through Electron to use browser controls.</div> : null}
        {activeTab && activePage === 'newtab' ? (
          <NewTabPage
            tabId={activeTab.id}
            tabs={browserState.tabs}
            bookmarks={bookmarks}
            settings={settings}
            studySession={studySession}
            now={now}
            onStartStudy={(minutes) => void startStudy(minutes)}
            onOpenStudyPanel={() => setActivePanel('study')}
          />
        ) : null}
        {activeTab && activePage === 'history' ? <HistoryPage tabId={activeTab.id} /> : null}
        {activeTab && activePage === 'bookmarks' ? <BookmarksPage tabId={activeTab.id} bookmarks={bookmarks} section={section} onToast={showToast} /> : null}
        {activeTab && activePage === 'settings' ? (
          <SettingsPage
            settings={settings}
            section={section}
            account={account}
            diagnostics={diagnostics}
            sitePermissions={sitePermissions}
            updateState={updateState}
            adBlock={adBlock}
            onRefreshPermissions={setSitePermissions}
            onAccount={setAccount}
            onDiagnostics={setDiagnostics}
            onUpdateState={setUpdateState}
            onToast={(message) => showToast(message)}
          />
        ) : null}
      </main>

      {activePanel === 'study' ? (
        <StudyPanel
          state={studyState}
          aiState={aiState}
          now={now}
          onStart={(minutes) => void startStudy(minutes)}
          onStop={() => void stopStudy()}
          onClearHistory={() => void bridge?.clearStudyHistory().then(setStudyState)}
          onClose={() => setActivePanel(null)}
        />
      ) : null}
      {activePanel === 'insights' ? <InsightsPanel insights={insights} onClose={() => setActivePanel(null)} /> : null}
      {activePanel === 'downloads' ? (
        <DownloadsPanel
          downloads={downloads}
          onOpen={(id) => void bridge?.openDownload(id)}
          onShow={(id) => void bridge?.showDownload(id)}
          onCancel={(id) => void bridge?.cancelDownload(id)}
          onClear={() => void bridge?.clearDownloads().then(setDownloads)}
          onClose={() => setActivePanel(null)}
        />
      ) : null}

      {toast ? (
        <div className="toast" role="status" key={toast.id}>
          <span>{toast.message}</span>
          {toast.action ? (
            <button
              type="button"
              onClick={() => {
                toast.action?.run();
                setToast(null);
              }}
            >
              {toast.action.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
