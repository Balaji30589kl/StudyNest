import { Download, Keyboard, Monitor, Palette, Power, RefreshCw, Search, Shield, SlidersHorizontal, User } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { BrowserSettings, StartupBehavior, ThemePreference } from '../../../shared/browser-settings.js';
import type { AccountStateSnapshot, AdBlockState, DefaultBrowserState, DiagnosticsSnapshot, SitePermission, UpdateState } from '../../../shared/ipc.js';
import { SEARCH_ENGINES, SearchEngineId } from '../../../shared/search-engines.js';
import { AccountSection } from '../AccountSection.js';
import { bridge } from '../components/common.js';
import { SitePermissionsSection } from '../SitePermissionsSection.js';
import { UpdatesSection } from '../UpdatesSection.js';

const SECTIONS = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'startup', label: 'On startup', icon: Power },
  { id: 'privacy', label: 'Privacy', icon: Shield },
  { id: 'permissions', label: 'Site permissions', icon: SlidersHorizontal },
  { id: 'default-browser', label: 'Default browser', icon: Monitor },
  { id: 'account', label: 'Account & sync', icon: User },
  { id: 'updates', label: 'Updates', icon: RefreshCw },
  { id: 'shortcuts', label: 'Keyboard shortcuts', icon: Keyboard }
] as const;

const SHORTCUTS: Array<[string, string]> = [
  ['New tab', 'Ctrl+T'],
  ['Close tab', 'Ctrl+W'],
  ['Reopen closed tab', 'Ctrl+Shift+T'],
  ['Next / previous tab', 'Ctrl+Tab / Ctrl+Shift+Tab'],
  ['Go to tab 1–8 / last tab', 'Ctrl+1…8 / Ctrl+9'],
  ['Focus the address bar', 'Ctrl+L, Alt+D, F6'],
  ['Find in page', 'Ctrl+F'],
  ['Bookmark this page', 'Ctrl+D'],
  ['Show or hide the bookmarks bar', 'Ctrl+Shift+B'],
  ['Bookmarks', 'Ctrl+Shift+O'],
  ['History', 'Ctrl+H'],
  ['Downloads', 'Ctrl+J'],
  ['Print', 'Ctrl+P'],
  ['Reload / reload without cache', 'Ctrl+R / Ctrl+Shift+R'],
  ['Back / forward', 'Alt+Left / Alt+Right'],
  ['Home (new tab page)', 'Alt+Home'],
  ['Zoom in / out / reset', 'Ctrl+= / Ctrl+- / Ctrl+0'],
  ['Developer tools', 'F12'],
  ['Settings', 'Ctrl+,'],
  ['Clear browsing data', 'Ctrl+Shift+Delete']
];

const RANGES = [
  { label: 'Last hour', ms: 60 * 60 * 1000 },
  { label: 'Last 24 hours', ms: 24 * 60 * 60 * 1000 },
  { label: 'Last 7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: 'All time', ms: 0 }
];

type Props = {
  settings: BrowserSettings;
  section: string | null;
  account: AccountStateSnapshot | null;
  diagnostics: DiagnosticsSnapshot | null;
  sitePermissions: SitePermission[];
  updateState: UpdateState | null;
  adBlock: AdBlockState | null;
  onRefreshPermissions: (permissions: SitePermission[]) => void;
  onAccount: (account: AccountStateSnapshot) => void;
  onDiagnostics: (diagnostics: DiagnosticsSnapshot) => void;
  onUpdateState: (state: UpdateState) => void;
  onToast: (message: string) => void;
};

function Switch({ checked, label, onChange }: { checked: boolean; label: string; onChange: (value: boolean) => void }) {
  return <button type="button" role="switch" className="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />;
}

function Segmented<T extends string>({ value, options, label, onChange }: { value: T; options: Array<[T, string]>; label: string; onChange: (value: T) => void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([option, text]) => (
        <button key={option} type="button" role="radio" aria-checked={value === option} className={value === option ? 'selected' : undefined} onClick={() => onChange(option)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function SettingsPage(props: Props) {
  const { settings } = props;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [current, setCurrent] = useState<string>(props.section ?? 'appearance');
  const [defaultBrowser, setDefaultBrowser] = useState<DefaultBrowserState | null>(null);
  const [clear, setClear] = useState({ range: RANGES[1]!.ms, history: true, cookies: false, cache: true });
  const [clearing, setClearing] = useState(false);

  const update = (changes: Partial<BrowserSettings>) => void bridge?.updateSettings(changes);

  useEffect(() => {
    void bridge?.getDefaultBrowserState().then(setDefaultBrowser);
  }, []);

  // Open at the requested section (studynest://settings#privacy).
  useEffect(() => {
    if (!props.section) return;
    const id = props.section.split('=', 1)[0]!;
    requestAnimationFrame(() => document.getElementById(`settings-${id}`)?.scrollIntoView({ block: 'start' }));
    setCurrent(id);
  }, [props.section]);

  // Highlight the section being read.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const onScroll = () => {
      let active: string = SECTIONS[0].id;
      for (const section of SECTIONS) {
        const element = document.getElementById(`settings-${section.id}`);
        if (element && element.getBoundingClientRect().top - container.getBoundingClientRect().top < 120) active = section.id;
      }
      setCurrent(active);
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, []);

  const clearData = async () => {
    if (!bridge) return;
    setClearing(true);
    await bridge.clearBrowsingData({ since: clear.range ? Date.now() - clear.range : 0, history: clear.history, cookies: clear.cookies, cache: clear.cache });
    setClearing(false);
    props.onToast('Browsing data cleared');
  };

  return (
    <div className="internal-page" ref={scrollRef}>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          <h1>Settings</h1>
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={current === id ? 'active' : undefined}
              onClick={() => {
                document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                setCurrent(id);
              }}
            >
              <Icon size={16} strokeWidth={1.9} />
              {label}
            </button>
          ))}
        </nav>

        <div>
          <section id="settings-appearance" className="settings-section">
            <h2>Appearance</h2>
            <div className="settings-card">
              <div className="setting-row">
                <div className="setting-text">
                  <strong>Theme</strong>
                  <span>System follows your Windows light or dark mode.</span>
                </div>
                <Segmented<ThemePreference>
                  label="Theme"
                  value={settings.theme}
                  options={[
                    ['system', 'System'],
                    ['light', 'Light'],
                    ['dark', 'Dark']
                  ]}
                  onChange={(theme) => update({ theme })}
                />
              </div>
              <div className="setting-row">
                <div className="setting-text">
                  <strong>Show bookmarks bar</strong>
                  <span>Your bookmarks, one click away under the address bar. Ctrl+Shift+B</span>
                </div>
                <Switch label="Show bookmarks bar" checked={settings.showBookmarksBar} onChange={(showBookmarksBar) => update({ showBookmarksBar })} />
              </div>
            </div>
          </section>

          <section id="settings-search" className="settings-section">
            <h2>Search</h2>
            <div className="settings-card">
              <div className="setting-row">
                <div className="setting-text">
                  <strong>Search engine</strong>
                  <span>Used for searches typed in the address bar and on the new tab page.</span>
                </div>
                <select aria-label="Search engine" value={settings.searchEngine} onChange={(event) => update({ searchEngine: event.target.value as SearchEngineId })}>
                  {SEARCH_ENGINES.map((engine) => (
                    <option key={engine.id} value={engine.id}>
                      {engine.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="setting-row">
                <div className="setting-text">
                  <strong>Search suggestions</strong>
                  <span>Suggest searches as you type (sends what you type to DuckDuckGo).</span>
                </div>
                <Switch label="Search suggestions" checked={settings.searchSuggestions} onChange={(searchSuggestions) => update({ searchSuggestions })} />
              </div>
            </div>
          </section>

          <section id="settings-startup" className="settings-section">
            <h2>On startup</h2>
            <div className="settings-card">
              <div className="setting-row">
                <div className="setting-text">
                  <strong>When StudyNest starts</strong>
                  <span>Reopen your tabs from last time, or start with a new tab.</span>
                </div>
                <Segmented<StartupBehavior>
                  label="On startup"
                  value={settings.startup}
                  options={[
                    ['restore', 'Continue where I left off'],
                    ['new-tab', 'Open a new tab']
                  ]}
                  onChange={(startup) => update({ startup })}
                />
              </div>
            </div>
          </section>

          <section id="settings-privacy" className="settings-section">
            <h2>Privacy</h2>
            <div className="settings-card">
              <div className="setting-row">
                <div className="setting-text">
                  <strong>Block ads and trackers</strong>
                  <span>
                    {props.adBlock?.ready
                      ? `Uses the EasyList and uBlock Origin filter lists. ${props.adBlock.totalBlocked.toLocaleString()} blocked since StudyNest started.`
                      : (props.adBlock?.error ?? 'Downloading filter lists…')}
                  </span>
                </div>
                <Switch label="Block ads and trackers" checked={settings.adBlocking} onChange={(adBlocking) => update({ adBlocking })} />
              </div>
              {settings.adBlockExceptions.length > 0 ? (
                <div className="setting-row">
                  <div className="setting-text">
                    <strong>Sites allowed to show ads</strong>
                    <div className="exception-list" style={{ marginTop: 6 }}>
                      {settings.adBlockExceptions.map((host) => (
                        <span key={host} className="exception-chip">
                          {host}
                          <button
                            type="button"
                            aria-label={`Block ads on ${host} again`}
                            title="Block ads here again"
                            onClick={() => update({ adBlockExceptions: settings.adBlockExceptions.filter((entry) => entry !== host) })}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="setting-row" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 12 }}>
                <div className="setting-text">
                  <strong>Clear browsing data</strong>
                  <span>Study Mode history and Focus Insights are kept; clear them in the Study panel.</span>
                </div>
                <div className="check-list">
                  <label>
                    Time range{' '}
                    <select aria-label="Time range" value={clear.range} onChange={(event) => setClear({ ...clear, range: Number(event.target.value) })}>
                      {RANGES.map((range) => (
                        <option key={range.label} value={range.ms}>
                          {range.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <input type="checkbox" checked={clear.history} onChange={(event) => setClear({ ...clear, history: event.target.checked })} /> Browsing history
                  </label>
                  <label>
                    <input type="checkbox" checked={clear.cache} onChange={(event) => setClear({ ...clear, cache: event.target.checked })} /> Cached images and files
                  </label>
                  <label title="Signs you out of most sites">
                    <input type="checkbox" checked={clear.cookies} onChange={(event) => setClear({ ...clear, cookies: event.target.checked })} /> Cookies and site data
                  </label>
                </div>
                {clear.cookies && clear.range ? <span className="warning-text">Cookies and site data are always cleared for all time.</span> : null}
                <button type="button" className="button danger" disabled={clearing || (!clear.history && !clear.cache && !clear.cookies)} onClick={() => void clearData()}>
                  {clearing ? 'Clearing…' : 'Clear data'}
                </button>
              </div>
            </div>
          </section>

          <section id="settings-permissions" className="settings-section">
            <h2>Site permissions</h2>
            <div className="settings-card">
              <SitePermissionsSection
                permissions={props.sitePermissions}
                onReset={(origin, key) => void bridge?.resetSitePermissions(origin, key).then(props.onRefreshPermissions)}
              />
            </div>
          </section>

          <section id="settings-default-browser" className="settings-section">
            <h2>Default browser</h2>
            <div className="settings-card">
              <div className="setting-row">
                <div className="setting-text">
                  <strong>{defaultBrowser?.isDefault ? 'StudyNest is your default browser' : 'Make StudyNest your default browser'}</strong>
                  <span>
                    {defaultBrowser?.canSet
                      ? 'Links you open from other apps will open here. Windows asks you to confirm in Settings.'
                      : 'Available in the installed version of StudyNest.'}
                  </span>
                </div>
                <button
                  type="button"
                  className="button"
                  disabled={!defaultBrowser?.canSet || defaultBrowser.isDefault}
                  onClick={() => void bridge?.setDefaultBrowser().then(setDefaultBrowser)}
                >
                  Make default
                </button>
              </div>
            </div>
          </section>

          <section id="settings-account" className="settings-section">
            <h2>Account & sync</h2>
            <div className="settings-card">
              <AccountSection
                account={props.account}
                diagnostics={props.diagnostics}
                onUpdateProfile={(profile) => void bridge?.updateProfile(profile).then(props.onAccount)}
                onChooseFolder={() => void bridge?.chooseSyncFolder().then(props.onAccount)}
                onDisableSync={() => void bridge?.configureSync({ folder: null }).then(props.onAccount)}
                onToggleBrowsingDetails={(include) => void bridge?.configureSync({ includeBrowsingDetails: include }).then(props.onAccount)}
                onSyncNow={() => void bridge?.syncNow().then(props.onAccount)}
                onRefreshDiagnostics={() => void bridge?.getDiagnostics().then(props.onDiagnostics)}
              />
            </div>
          </section>

          <section id="settings-updates" className="settings-section">
            <h2>Updates</h2>
            <div className="settings-card">
              <UpdatesSection
                state={props.updateState}
                onCheck={() => void bridge?.checkForUpdates().then(props.onUpdateState)}
                onInstall={() => void bridge?.installUpdate()}
              />
            </div>
          </section>

          <section id="settings-shortcuts" className="settings-section">
            <h2>Keyboard shortcuts</h2>
            <div className="settings-card">
              <table className="shortcut-table">
                <tbody>
                  {SHORTCUTS.map(([action, keys]) => (
                    <tr key={action}>
                      <td>{action}</td>
                      <td>
                        {keys.split(/(\s\/\s|,\s)/).map((part, index) =>
                          part.trim() === '/' || part.trim() === ',' ? (
                            <span key={index} className="muted">
                              {part}
                            </span>
                          ) : (
                            <kbd key={index}>{part}</kbd>
                          )
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <p className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Download size={14} /> Downloads are saved to your Downloads folder. Open them with Ctrl+J.
          </p>
        </div>
      </div>
    </div>
  );
}
