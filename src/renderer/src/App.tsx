import { FormEvent, useEffect, useMemo, useState } from 'react';
import { BROWSER_CHROME_HEIGHT, BrowserStateSnapshot, BrowserTabState } from '../../shared/ipc.js';
import { displayUrl } from '../../shared/url.js';

const DEFAULT_HOME_PAGE = 'https://example.com';
const HOME_PAGE_STORAGE_KEY = 'studynest.homePage';

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

  useEffect(() => {
    const savedHomePage = window.localStorage.getItem(HOME_PAGE_STORAGE_KEY);
    if (savedHomePage) {
      setHomePage(savedHomePage);
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

  const activeTab = useMemo(() => getActiveTab(browserState), [browserState]);

  useEffect(() => {
    if (!activeTab || isEditing) {
      return;
    }

    setAddressInput(displayUrl(activeTab.url));
  }, [activeTab?.id, activeTab?.url, isEditing]);

  async function openHomeTab() {
    if (!bridge) {
      return;
    }

    await bridge.newTab(homePage);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (addressInput.trim().length === 0) {
      return;
    }

    if (!bridge) {
      return;
    }

    await bridge.navigate(addressInput, browserState.activeTabId ?? undefined);
    setIsEditing(false);
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
    <div className="app-shell" style={{ ['--chrome-height' as string]: `${BROWSER_CHROME_HEIGHT}px` }}>
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
            onChange={(event) => setAddressInput(event.target.value)}
            onFocus={() => setIsEditing(true)}
            onBlur={() => {
              setIsEditing(false);
              if (activeTab) {
                setAddressInput(displayUrl(activeTab.url));
              }
            }}
            placeholder="Enter a URL or search term"
            spellCheck={false}
          />
          <button type="submit">Go</button>
        </form>

        <button type="button" className="settings-button" onClick={() => setSettingsOpen((value) => !value)}>
          Settings
        </button>
      </section>

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
        <div className="status-meta">Phase 1 shell | UI height {BROWSER_CHROME_HEIGHT}px</div>
      </main>
    </div>
  );
}
