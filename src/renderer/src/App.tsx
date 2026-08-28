import { FormEvent, KeyboardEvent, useEffect, useMemo, useState } from 'react';
import { BROWSER_CHROME_HEIGHT, BrowserStateSnapshot, BrowserTabState } from '../../shared/ipc.js';
import { displayUrl } from '../../shared/url.js';
import {
  buildOmniboxSuggestions,
  createRecentEntryList,
  fetchDuckDuckGoSuggestions,
  OmniboxSuggestion,
  toSearchSubmissionValue
} from './omnibox.js';

const DEFAULT_HOME_PAGE = 'https://example.com';
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recentEntries, setRecentEntries] = useState<string[]>([]);
  const [omniboxSuggestions, setOmniboxSuggestions] = useState<OmniboxSuggestion[]>([]);
  const [omniboxLoading, setOmniboxLoading] = useState(false);
  const [highlightedSuggestionIndex, setHighlightedSuggestionIndex] = useState(0);
  const [chromeHeight, setChromeHeight] = useState(BROWSER_CHROME_HEIGHT);

  useEffect(() => {
    const savedHomePage = window.localStorage.getItem(HOME_PAGE_STORAGE_KEY);
    if (savedHomePage) {
      setHomePage(savedHomePage);
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

  const omniboxPanelHeight = useMemo(() => {
    if (!isEditing || visibleSuggestions.length === 0) {
      return 0;
    }

    return Math.min(visibleSuggestions.length, OMNIBOX_SUGGESTION_MAX_ROWS) * OMNIBOX_SUGGESTION_ROW_HEIGHT + OMNIBOX_PANEL_PADDING;
  }, [isEditing, visibleSuggestions.length]);

  useEffect(() => {
    const nextChromeHeight = BROWSER_CHROME_HEIGHT + omniboxPanelHeight;
    setChromeHeight(nextChromeHeight);

    if (bridge) {
      void bridge.setChromeHeight(nextChromeHeight);
    }
  }, [omniboxPanelHeight]);

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
    window.localStorage.setItem(HOME_PAGE_STORAGE_KEY, homePage.trim() || DEFAULT_HOME_PAGE);
    setSettingsOpen(false);
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
      style={{
        ['--chrome-height' as string]: `${chromeHeight}px`,
        ['--omnibox-panel-height' as string]: `${omniboxPanelHeight}px`
      }}
    >
      <header className="titlebar">
        <div className="brand-block">
          <div className="brand-mark">S</div>
          <div>
            <div className="brand-title">StudyNest</div>
            <div className="brand-subtitle">Browser shell</div>
          </div>
        </div>

        <div className="window-controls">
          <button className="window-button" type="button" onClick={() => void bridge?.minimize()} aria-label="Minimize window">
            _
          </button>
          <button className="window-button" type="button" onClick={() => void bridge?.toggleMaximize()} aria-label="Maximize or restore window">
            ☐
          </button>
          <button className="window-button danger" type="button" onClick={() => void bridge?.close()} aria-label="Close window">
            ×
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

        <form className="address-form" onSubmit={handleSubmit}>
          <input
            value={addressInput}
            onChange={(event) => {
              setAddressInput(event.target.value);
              setIsEditing(true);
            }}
            onFocus={() => setIsEditing(true)}
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

        <button type="button" className="settings-button" onClick={() => setSettingsOpen((value) => !value)}>
          Settings
        </button>
      </section>

      {isEditing ? (
        <section className="omnibox-panel" aria-label="Search suggestions">
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
          <button
            key={tab.id}
            type="button"
            className={tab.id === browserState.activeTabId ? 'tab active' : 'tab'}
            onClick={() => handleSelectTab(tab.id)}
          >
            <span className="tab-title">{tab.title}</span>
            <span className="tab-url">{displayUrl(tab.url)}</span>
            <span
              className="tab-close"
              role="button"
              tabIndex={0}
              aria-label={`Close ${tab.title}`}
              onClick={(event) => {
                event.stopPropagation();
                void handleCloseTab(tab.id);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  event.stopPropagation();
                  void handleCloseTab(tab.id);
                }
              }}
            >
              ×
            </span>
          </button>
        ))}
      </section>

      {bridge ? null : <div className="bridge-warning">Open this app through Electron to use browser controls.</div>}

      {settingsOpen ? (
        <aside className="settings-panel">
          <h2>Basic Settings</h2>
          <label>
            Homepage
            <input value={homePage} onChange={(event) => handleHomePageChange(event.target.value)} placeholder={DEFAULT_HOME_PAGE} />
          </label>
          <div className="settings-actions">
            <button type="button" className="primary" onClick={handleSaveSettings}>
              Save
            </button>
            <button type="button" onClick={() => setSettingsOpen(false)}>
              Cancel
            </button>
          </div>
        </aside>
      ) : null}

      <main className="status-bar">
        <div>
          {activeTab ? (
            <>
              <strong>{activeTab.title}</strong>
              <span>{displayUrl(activeTab.url)}</span>
              {activeTab.isLoading ? <em>Loading...</em> : <em>Ready</em>}
            </>
          ) : (
            <span>No active tab</span>
          )}
        </div>
        <div className="status-meta">Phase 1.1 shell | chrome {chromeHeight}px</div>
      </main>
    </div>
  );
}
