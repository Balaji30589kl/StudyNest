import { FormEvent, KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { InsightsSnapshot } from '../../shared/insights.js';
import {
  AccountStateSnapshot,
  AiStateSnapshot,
  BrowserCommand,
  DiagnosticsSnapshot,
  DownloadEntry,
  PageSnapshot,
  SitePermission,
  UpdateState,
  BROWSER_CHROME_HEIGHT,
  BrowserStateSnapshot,
  BrowserTabState,
  StudyStateSnapshot
} from '../../shared/ipc.js';
import { displayUrl } from '../../shared/url.js';
import { LANDING_PAGE_URL } from '../../shared/landing-page.js';
import {
  buildOmniboxSuggestions,
  createRecentEntryList,
  fetchDuckDuckGoSuggestions,
  OmniboxSuggestion,
  toSearchSubmissionValue
} from './omnibox.js';
import { AccountSection } from './AccountSection.js';
import { DownloadsPanel } from './DownloadsPanel.js';
import { InsightsPanel } from './InsightsPanel.js';
import { SitePermissionsSection } from './SitePermissionsSection.js';
import { UpdatesSection } from './UpdatesSection.js';
import { StudyPanel } from './StudyPanel.js';
import { formatCountdown, formatElapsed } from './study-format.js';

type SidePanel = 'settings' | 'study' | 'insights' | 'downloads' | null;
const SIDE_PANEL_WIDTH = 380;
const DEFAULT_HOME_PAGE = LANDING_PAGE_URL;
const HOME_PAGE_STORAGE_KEY = 'studynest.homePage';
const RECENT_SEARCHES_STORAGE_KEY = 'studynest.recentSearches';
const OMNIBOX_SUGGESTION_ROW_HEIGHT = 44;
const OMNIBOX_SUGGESTION_MAX_ROWS = 6;
const OMNIBOX_PANEL_PADDING = 16;

const bridge = typeof window !== 'undefined' && window.studyNest ? window.studyNest : null;

function getActiveTab(state: BrowserStateSnapshot): BrowserTabState | undefined {
  return state.tabs.find((tab) => tab.id === state.activeTabId);
}

export function App() {
  const [browserState, setBrowserState] = useState<BrowserStateSnapshot>({ tabs: [], activeTabId: null });
  const [addressInput, setAddressInput] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [homePage, setHomePage] = useState(DEFAULT_HOME_PAGE);
  const [activePanel, setActivePanel] = useState<SidePanel>(null);
  const [studyState, setStudyState] = useState<StudyStateSnapshot | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [aiState, setAiState] = useState<AiStateSnapshot | null>(null);
  const [insights, setInsights] = useState<InsightsSnapshot | null>(null);
  const [account, setAccount] = useState<AccountStateSnapshot | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot | null>(null);
  const [pageSnapshot, setPageSnapshot] = useState<PageSnapshot | null>(null);
  const addressFormRef = useRef<HTMLFormElement | null>(null);
  const addressInputRef = useRef<HTMLInputElement | null>(null);
  const [downloads, setDownloads] = useState<DownloadEntry[]>([]);
  const [sitePermissions, setSitePermissions] = useState<SitePermission[]>([]);
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);
  const [omniboxRect, setOmniboxRect] = useState<{ top: number; left: number; width: number } | null>(null);

  // Keyboard shortcuts that main forwards because they need renderer state.
  useEffect(() => {
    const focusAddress = () => {
      const input = addressInputRef.current;
      if (input) {
        input.focus();
        input.select();
      }
    };
    const handleCommand = (event: Event) => {
      const command = (event as CustomEvent<BrowserCommand>).detail;
      if (command?.type === 'focus-address') {
        focusAddress();
      } else if (command?.type === 'new-tab') {
        void openHomeTab().then(focusAddress);
      }
    };
    window.addEventListener('studynest:command', handleCommand);
    return () => window.removeEventListener('studynest:command', handleCommand);
  });

  // Anchor the suggestion dropdown directly under the address bar.
  useLayoutEffect(() => {
    if (!isEditing) {
      return;
    }
    const measure = () => {
      const rect = addressFormRef.current?.getBoundingClientRect();
      if (rect) {
        setOmniboxRect({ top: rect.bottom + 6, left: rect.left, width: rect.width });
      }
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [isEditing, activePanel]);
  const [recentEntries, setRecentEntries] = useState<string[]>([]);
  const [omniboxSuggestions, setOmniboxSuggestions] = useState<OmniboxSuggestion[]>([]);
  const [omniboxLoading, setOmniboxLoading] = useState(false);
  const [highlightedSuggestionIndex, setHighlightedSuggestionIndex] = useState(0);

  useEffect(() => {
    const savedHomePage = window.localStorage.getItem(HOME_PAGE_STORAGE_KEY);
    if (savedHomePage) {
      setHomePage(savedHomePage === 'https://example.com' ? LANDING_PAGE_URL : savedHomePage);
    } else {
      setHomePage(LANDING_PAGE_URL);
    }

    const savedRecentEntries = window.localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY);
    if (savedRecentEntries) {
      try {
        const parsed = JSON.parse(savedRecentEntries) as unknown;
        if (Array.isArray(parsed)) {
          setRecentEntries(parsed.filter((entry): entry is string => typeof entry === 'string'));
        }
      } catch {
        // Ignore malformed local state.
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!bridge) {
      return () => {
        cancelled = true;
      };
    }

    bridge.getState().then((snapshot) => {
      if (!cancelled) {
        setBrowserState(snapshot);
      }
    });

    const handleStateChanged = (event: Event) => {
      const customEvent = event as CustomEvent<BrowserStateSnapshot>;
      setBrowserState(customEvent.detail);
    };

    window.addEventListener('studynest:state-changed', handleStateChanged);

    return () => {
      cancelled = true;
      window.removeEventListener('studynest:state-changed', handleStateChanged);
    };
  }, []);

  useEffect(() => {
    if (!bridge) {
      return;
    }

    let cancelled = false;
    void bridge.getStudyState().then((snapshot) => {
      if (!cancelled) {
        setStudyState(snapshot);
      }
    });

    const handleStudyChanged = (event: Event) => {
      setStudyState((event as CustomEvent<StudyStateSnapshot>).detail);
    };
    window.addEventListener('studynest:study-changed', handleStudyChanged);

    void bridge.getAiState().then((snapshot) => {
      if (!cancelled) {
        setAiState(snapshot);
      }
    });
    const handleAiChanged = (event: Event) => {
      setAiState((event as CustomEvent<AiStateSnapshot>).detail);
    };
    window.addEventListener('studynest:ai-changed', handleAiChanged);

    void bridge.getAccountState().then((snapshot) => {
      if (!cancelled) {
        setAccount(snapshot);
      }
    });
    const handleAccountChanged = (event: Event) => {
      setAccount((event as CustomEvent<AccountStateSnapshot>).detail);
    };
    window.addEventListener('studynest:account-changed', handleAccountChanged);

    void bridge.getDownloads().then((entries) => {
      if (!cancelled) {
        setDownloads(entries);
      }
    });
    const handleDownloadsChanged = (event: Event) => {
      const entries = (event as CustomEvent<DownloadEntry[]>).detail;
      setDownloads((previous) => {
        // Open the panel when a new download starts.
        if (entries.some((entry) => !previous.some((old) => old.id === entry.id))) {
          setActivePanel('downloads');
        }
        return entries;
      });
    };
    window.addEventListener('studynest:downloads-changed', handleDownloadsChanged);

    void bridge.getUpdateState().then((state) => {
      if (!cancelled) {
        setUpdateState(state);
      }
    });
    const handleUpdateChanged = (event: Event) => setUpdateState((event as CustomEvent<UpdateState>).detail);
    window.addEventListener('studynest:update-changed', handleUpdateChanged);

    return () => {
      window.removeEventListener('studynest:downloads-changed', handleDownloadsChanged);
      window.removeEventListener('studynest:update-changed', handleUpdateChanged);
      window.removeEventListener('studynest:account-changed', handleAccountChanged);
      cancelled = true;
      window.removeEventListener('studynest:study-changed', handleStudyChanged);
      window.removeEventListener('studynest:ai-changed', handleAiChanged);
    };
  }, []);

  const studySession = studyState?.session ?? null;
  const activeDownloads = downloads.filter((entry) => entry.state === 'progressing').length;

  useEffect(() => {
    setNow(Date.now());
    if (!studySession) {
      return;
    }
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [studySession?.id]);

  // Refresh live session stats periodically while the Study panel is visible.
  useEffect(() => {
    if (!bridge || activePanel !== 'study' || !studySession) {
      return;
    }
    const intervalId = window.setInterval(() => {
      void bridge.getStudyState().then(setStudyState);
    }, 15000);
    return () => window.clearInterval(intervalId);
  }, [activePanel, studySession?.id]);

  // Insights are recomputed in main whenever the panel opens or session history changes.
  const latestSessionId = studyState?.recentSessions[0]?.id;
  useEffect(() => {
    if (bridge && activePanel === 'insights') {
      void bridge.getInsights().then(setInsights);
    }
  }, [activePanel, latestSessionId, studyState?.recentSessions.length]);

  useEffect(() => {
    if (bridge && activePanel === 'settings') {
      void bridge.getDiagnostics().then(setDiagnostics);
      void bridge.getSitePermissions().then(setSitePermissions);
    }
  }, [activePanel]);

  // The page view is a native layer drawn above the renderer. While the omnibox is open,
  // show a still image of the page and hide the live view so the dropdown is visible.
  useEffect(() => {
    if (!bridge) {
      return;
    }
    let cancelled = false;
    if (isEditing) {
      void bridge.capturePage().then((snapshot) => {
        if (cancelled) {
          return;
        }
        setPageSnapshot(snapshot);
        // Hide the live view only after the still image has painted, to avoid a flash.
        requestAnimationFrame(() => {
          if (!cancelled) {
            void bridge.setPageViewHidden(true);
          }
        });
      });
    } else {
      void bridge.setPageViewHidden(false).then(() => {
        requestAnimationFrame(() => {
          if (!cancelled) {
            setPageSnapshot(null);
          }
        });
      });
    }
    return () => {
      cancelled = true;
    };
  }, [isEditing]);

  // The page view is a native layer above the renderer, so main must make room for side panels.
  useEffect(() => {
    void bridge?.setContentInsetRight(activePanel ? SIDE_PANEL_WIDTH : 0);
  }, [activePanel]);

  useEffect(() => {
    if (!isEditing) {
      setOmniboxSuggestions([]);
      setOmniboxLoading(false);
      setHighlightedSuggestionIndex(0);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      setOmniboxLoading(true);

      void fetchDuckDuckGoSuggestions(addressInput, controller.signal)
        .then((remoteSuggestions) => {
          if (controller.signal.aborted) {
            return;
          }

          const nextSuggestions = buildOmniboxSuggestions(addressInput, browserState.tabs, recentEntries, remoteSuggestions);
          setOmniboxSuggestions(nextSuggestions);
          setHighlightedSuggestionIndex(0);
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            const nextSuggestions = buildOmniboxSuggestions(addressInput, browserState.tabs, recentEntries, []);
            setOmniboxSuggestions(nextSuggestions);
            setHighlightedSuggestionIndex(0);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setOmniboxLoading(false);
          }
        });
    }, 150);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [addressInput, browserState.tabs, isEditing, recentEntries]);

  const activeTab = useMemo(() => getActiveTab(browserState), [browserState]);
  const visibleSuggestions = useMemo(() => {
    if (!isEditing) {
      return [] as OmniboxSuggestion[];
    }

    if (omniboxLoading && omniboxSuggestions.length === 0) {
      return [
        {
          id: 'omnibox-loading',
          kind: 'remote-search' as const,
          label: 'Searching suggestions...',
          detail: 'DuckDuckGo',
          value: addressInput.trim()
        }
      ] as OmniboxSuggestion[];
    }

    return omniboxSuggestions;
  }, [addressInput, isEditing, omniboxLoading, omniboxSuggestions]);

  useEffect(() => {
    if (!activeTab || isEditing) {
      return;
    }

    setAddressInput(displayUrl(activeTab.url));
  }, [activeTab?.id, activeTab?.url, isEditing]);

  function persistRecentEntry(value: string) {
    const nextRecentEntries = createRecentEntryList(recentEntries, value);
    setRecentEntries(nextRecentEntries);
    window.localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(nextRecentEntries));
  }

  async function commitNavigation(value: string) {
    if (!bridge) {
      return;
    }

    const navigationTarget = value.trim();
    if (navigationTarget.length === 0) {
      return;
    }

    await bridge.navigate(navigationTarget, browserState.activeTabId ?? undefined);
    persistRecentEntry(navigationTarget);
    setIsEditing(false);
    setOmniboxSuggestions([]);
    setOmniboxLoading(false);
    setHighlightedSuggestionIndex(0);
  }

  async function submitSuggestion(index: number) {
    const suggestion = visibleSuggestions[index];
    if (!suggestion) {
      return;
    }

    await commitNavigation(toSearchSubmissionValue(suggestion));
  }

  async function openHomeTab() {
    if (!bridge) {
      return;
    }

    await bridge.newTab(homePage);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (visibleSuggestions.length > 0 && highlightedSuggestionIndex >= 0) {
      await submitSuggestion(highlightedSuggestionIndex);
      return;
    }

    if (addressInput.trim().length === 0) {
      return;
    }

    await commitNavigation(addressInput);
  }

  function handleAddressKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (visibleSuggestions.length === 0) {
      if (event.key === 'Escape') {
        setIsEditing(false);
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedSuggestionIndex((currentIndex) => (currentIndex + 1) % visibleSuggestions.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedSuggestionIndex((currentIndex) => (currentIndex - 1 + visibleSuggestions.length) % visibleSuggestions.length);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setIsEditing(false);
      setOmniboxSuggestions([]);
      setOmniboxLoading(false);
      setHighlightedSuggestionIndex(0);
    }
  }

  function handleSaveSettings() {
    window.localStorage.setItem(HOME_PAGE_STORAGE_KEY, homePage.trim() || LANDING_PAGE_URL);
    setActivePanel(null);
  }

  function togglePanel(panel: Exclude<SidePanel, null>) {
    setActivePanel((current) => (current === panel ? null : panel));
  }

  /** Minutes for a timed session, or null to switch Study Mode on without a timer. */
  async function handleStartStudy(durationMinutes: number | null) {
    if (bridge) {
      setStudyState(await bridge.startStudySession(durationMinutes));
    }
  }

  async function handleStopStudy() {
    if (bridge) {
      setStudyState(await bridge.stopStudySession());
    }
  }

  async function handleToggleStudy() {
    if (studySession) {
      await handleStopStudy();
    } else {
      await handleStartStudy(null);
    }
  }

  async function handleClearStudyHistory() {
    if (bridge) {
      setStudyState(await bridge.clearStudyHistory());
    }
  }

  function handleHomePageChange(value: string) {
    setHomePage(value);
  }

  async function handleSelectTab(tabId: string) {
    if (!bridge) {
      return;
    }

    await bridge.switchTab(tabId);
  }

  async function handleCloseTab(tabId: string) {
    if (!bridge) {
      return;
    }

    await bridge.closeTab(tabId);
  }

  return (
    <div
      className="app-shell"
      style={{ ['--chrome-height' as string]: `${BROWSER_CHROME_HEIGHT}px` }}
    >
      <header className="titlebar">
        <div className="brand-block">
          <div className="brand-mark">S</div>
          <div>
            <div className="brand-title">StudyNest</div>
            <div className="brand-subtitle">{studySession ? 'Study Mode on' : 'Browser'}</div>
          </div>
        </div>

        <div className="window-controls">
          <button className="window-button" type="button" onClick={() => void bridge?.minimize()} aria-label="Minimize window">
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6h8" /></svg>
          </button>
          <button className="window-button" type="button" onClick={() => void bridge?.toggleMaximize()} aria-label="Maximize or restore window">
            <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.5" y="2.5" width="7" height="7" rx="1" /></svg>
          </button>
          <button className="window-button danger" type="button" onClick={() => void bridge?.close()} aria-label="Close window">
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" /></svg>
          </button>
        </div>
      </header>

      <section className="toolbar">
        <div className="nav-buttons">
          <button type="button" onClick={() => void bridge?.goBack(browserState.activeTabId ?? undefined)} disabled={!activeTab?.canGoBack}>
            Back
          </button>
          <button type="button" onClick={() => void bridge?.goForward(browserState.activeTabId ?? undefined)} disabled={!activeTab?.canGoForward}>
            Forward
          </button>
          <button type="button" onClick={() => void bridge?.refresh(browserState.activeTabId ?? undefined)}>
            Refresh
          </button>
          <button type="button" className="primary" onClick={() => void openHomeTab()}>
            New Tab
          </button>
        </div>

        <form className="address-form" onSubmit={handleSubmit} ref={addressFormRef}>
          <input
            ref={addressInputRef}
            aria-label="Address and search bar"
            value={addressInput}
            onChange={(event) => {
              setAddressInput(event.target.value);
              setIsEditing(true);
            }}
            onFocus={() => {
              setIsEditing(true);
            }}
            onBlur={() => {
              setIsEditing(false);
              setOmniboxLoading(false);
              if (activeTab) {
                setAddressInput(displayUrl(activeTab.url));
              }
            }}
            onKeyDown={handleAddressKeyDown}
            placeholder="Enter a URL or search term"
            spellCheck={false}
          />
          <button type="submit">Go</button>
        </form>

        <div className="toolbar-actions">
          <div className={studySession ? 'study-control active' : 'study-control'}>
            <button
              type="button"
              role="switch"
              className="study-switch"
              aria-checked={studySession !== null}
              aria-label="Study Mode"
              title={studySession ? 'Turn Study Mode off' : 'Turn Study Mode on'}
              onClick={() => void handleToggleStudy()}
            >
              <span className="study-switch-knob" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="study-button"
              onClick={() => togglePanel('study')}
              aria-pressed={activePanel === 'study'}
              aria-label="Open Study Mode panel"
            >
              {studySession
                ? studySession.endsAt !== null
                  ? `Focus ${formatCountdown(studySession.endsAt - now)}`
                  : `Studying ${formatElapsed(now - studySession.startedAt)}`
                : 'Study Mode'}
            </button>
          </div>
          {downloads.length > 0 ? (
            <button
              type="button"
              className="settings-button icon-button"
              onClick={() => togglePanel('downloads')}
              aria-pressed={activePanel === 'downloads'}
              aria-label={`Downloads${activeDownloads > 0 ? `, ${activeDownloads} in progress` : ''}`}
              title="Downloads"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M3 13h10" /></svg>
              {activeDownloads > 0 ? <span className="badge">{activeDownloads}</span> : null}
            </button>
          ) : null}
          <button type="button" className="settings-button" onClick={() => togglePanel('insights')} aria-pressed={activePanel === 'insights'}>
            Insights
          </button>
          <button type="button" className="settings-button" onClick={() => togglePanel('settings')} aria-pressed={activePanel === 'settings'}>
            Settings
          </button>
        </div>
      </section>

      {pageSnapshot ? (
        <img
          className="page-snapshot"
          src={pageSnapshot.dataUrl}
          alt=""
          aria-hidden="true"
          style={{
            left: pageSnapshot.bounds.x,
            top: pageSnapshot.bounds.y,
            width: pageSnapshot.bounds.width,
            height: pageSnapshot.bounds.height
          }}
        />
      ) : null}

      {isEditing ? (
        <section
          className="omnibox-panel"
          aria-label="Search suggestions"
          style={omniboxRect ? { top: omniboxRect.top, left: omniboxRect.left, width: omniboxRect.width } : undefined}
        >
          {visibleSuggestions.length > 0 ? (
            visibleSuggestions.map((suggestion, index) => (
              <button
                key={suggestion.id}
                type="button"
                className={index === highlightedSuggestionIndex ? 'omnibox-item active' : 'omnibox-item'}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  void submitSuggestion(index);
                }}
              >
                <span className="omnibox-item-label">{suggestion.label}</span>
                <span className="omnibox-item-detail">{suggestion.detail}</span>
              </button>
            ))
          ) : (
            <div className="omnibox-empty-state">Start typing to search or open a site.</div>
          )}
        </section>
      ) : null}

      <section className="tabs-row" aria-label="Tabs">
        {browserState.tabs.map((tab) => (
          <div
            key={tab.id}
            className={['tab', tab.id === browserState.activeTabId ? 'active' : '', tab.blocked ? 'blocked' : ''].filter(Boolean).join(' ')}
            title={`${tab.title}\n${displayUrl(tab.url)}`}
          >
            <button
              type="button"
              className="tab-main"
              onClick={() => handleSelectTab(tab.id)}
              aria-current={tab.id === browserState.activeTabId ? 'page' : undefined}
            >
              {tab.isLoading ? <span className="tab-spinner" aria-label="Loading" /> : <span className="tab-dot" aria-hidden="true" />}
              <span className="tab-title">{tab.title}</span>
            </button>
            <button type="button" className="tab-close" aria-label={`Close ${tab.title}`} onClick={() => void handleCloseTab(tab.id)}>
              <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" /></svg>
            </button>
          </div>
        ))}
      </section>

      {bridge ? null : <div className="bridge-warning">Open this app through Electron to use browser controls.</div>}

      {activePanel === 'study' ? (
        <StudyPanel
          state={studyState}
          aiState={aiState}
          now={now}
          onStart={(minutes) => void handleStartStudy(minutes)}
          onStop={() => void handleStopStudy()}
          onClearHistory={() => void handleClearStudyHistory()}
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

      {activePanel === 'settings' ? (
        <aside className="side-panel settings-panel" aria-label="Settings">
          <div className="side-panel-header">
            <h2>Basic Settings</h2>
            <button type="button" className="ghost-button" onClick={() => setActivePanel(null)} aria-label="Close settings">×</button>
          </div>
          <label>
            Homepage
            <input
              value={homePage === LANDING_PAGE_URL ? '' : homePage}
              onChange={(event) => handleHomePageChange(event.target.value || LANDING_PAGE_URL)}
              placeholder="StudyNest start page"
            />
            <span className="muted small">Leave empty to use the StudyNest start page.</span>
          </label>
          <div className="settings-actions">
            <button type="button" className="primary" onClick={handleSaveSettings}>
              Save
            </button>
            <button type="button" onClick={() => setActivePanel(null)}>
              Cancel
            </button>
          </div>
          <UpdatesSection
            state={updateState}
            onCheck={() => void bridge?.checkForUpdates().then(setUpdateState)}
            onInstall={() => void bridge?.installUpdate()}
          />
          <SitePermissionsSection
            permissions={sitePermissions}
            onReset={(origin, key) => void bridge?.resetSitePermissions(origin, key).then(setSitePermissions)}
          />
          <AccountSection
            account={account}
            diagnostics={diagnostics}
            onUpdateProfile={(profile) => void bridge?.updateProfile(profile).then(setAccount)}
            onChooseFolder={() => void bridge?.chooseSyncFolder().then(setAccount)}
            onDisableSync={() => void bridge?.configureSync({ folder: null }).then(setAccount)}
            onToggleBrowsingDetails={(include) => void bridge?.configureSync({ includeBrowsingDetails: include }).then(setAccount)}
            onSyncNow={() => void bridge?.syncNow().then(setAccount)}
            onRefreshDiagnostics={() => void bridge?.getDiagnostics().then(setDiagnostics)}
          />
        </aside>
      ) : null}

    </div>
  );
}
