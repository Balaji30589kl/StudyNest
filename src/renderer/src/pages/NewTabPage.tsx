import { Search, Timer } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { BrowserSettings } from '../../../shared/browser-settings.js';
import type { Bookmark, BrowserTabState, StudySessionState, TopSite } from '../../../shared/ipc.js';
import { getSearchEngine } from '../../../shared/search-engines.js';
import { normalizeNavigationInput } from '../../../shared/url.js';
import { siteIconUrl } from '../components/BookmarksBar.js';
import { BrandMark, bridge, Favicon, SuggestionList, useOmniboxSuggestions } from '../components/common.js';
import { OmniboxSuggestion } from '../omnibox.js';
import { formatCountdown, formatElapsed } from '../study-format.js';

type Props = {
  tabId: string;
  tabs: BrowserTabState[];
  bookmarks: Bookmark[];
  settings: BrowserSettings;
  studySession: StudySessionState | null;
  now: number;
  onStartStudy: (minutes: number | null) => void;
  onOpenStudyPanel: () => void;
};

/** "en.wikipedia.org" → "wikipedia", "bbc.co.uk" → "bbc": the part people call the site. */
export function siteName(host: string): string {
  const parts = host.replace(/^www\./, '').split('.');
  if (parts.length <= 2) return parts[0] ?? host;
  const secondLevel = ['co', 'com', 'org', 'net', 'ac', 'gov', 'edu'];
  return secondLevel.includes(parts[parts.length - 2]!) && parts.length >= 3 ? parts[parts.length - 3]! : parts[parts.length - 2]!;
}

export function NewTabPage({ tabId, tabs, bookmarks, settings, studySession, now, onStartStudy, onOpenStudyPanel }: Props) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [topSites, setTopSites] = useState<TopSite[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void bridge?.getTopSites().then(setTopSites);
    inputRef.current?.focus();
  }, [tabId]);

  const { suggestions } = useOmniboxSuggestions({
    input: query,
    active: focused && query.trim().length > 0,
    tabs,
    activeTabId: tabId,
    bookmarks,
    engine: settings.searchEngine,
    remoteEnabled: settings.searchSuggestions
  });
  useEffect(() => setHighlighted(0), [query]);

  const go = (suggestion: OmniboxSuggestion | null) => {
    if (!bridge) return;
    if (suggestion?.kind === 'tab' && suggestion.tabId) {
      void bridge.switchTab(suggestion.tabId);
      return;
    }
    const target = suggestion ? suggestion.url : normalizeNavigationInput(query, settings.searchEngine);
    if (query.trim() || suggestion) void bridge.navigate(target, tabId);
  };

  // Most visited sites, topped up with bookmarks for new profiles.
  const tiles: Array<{ url: string; title: string; host: string }> = [...topSites];
  for (const bookmark of bookmarks) {
    if (tiles.length >= 8) break;
    const host = (() => {
      try {
        return new URL(bookmark.url).hostname.replace(/^www\./, '');
      } catch {
        return '';
      }
    })();
    if (host && !tiles.some((tile) => tile.host === host)) tiles.push({ url: bookmark.url, title: bookmark.title, host });
  }

  return (
    <div className="internal-page">
      <div className="newtab">
        <div className="newtab-brand">
          <BrandMark />
          StudyNest
        </div>

        <form
          className="newtab-search"
          onSubmit={(event) => {
            event.preventDefault();
            go(suggestions[highlighted] ?? null);
          }}
        >
          <label className="newtab-search-box">
            <Search size={18} strokeWidth={2} />
            <input
              ref={inputRef}
              aria-label="Search the web"
              placeholder={`Search ${getSearchEngine(settings.searchEngine).name} or type an address`}
              value={query}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setQuery(event.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={(event) => {
                if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && suggestions.length > 0) {
                  event.preventDefault();
                  const delta = event.key === 'ArrowDown' ? 1 : -1;
                  setHighlighted((current) => (current + delta + suggestions.length) % suggestions.length);
                } else if (event.key === 'Escape') {
                  setQuery('');
                }
              }}
            />
          </label>
          {focused ? (
            <SuggestionList
              className="omnibox-panel inline"
              suggestions={suggestions}
              query={query}
              highlighted={highlighted}
              onHighlight={setHighlighted}
              onChoose={go}
            />
          ) : null}
        </form>

        {tiles.length > 0 ? (
          <nav className="tiles" aria-label="Most visited sites">
            {tiles.slice(0, 8).map((tile) => (
              <button
                key={tile.url}
                type="button"
                className="tile"
                title={tile.url}
                onClick={(event) => (event.ctrlKey ? void bridge?.newTab(tile.url) : void bridge?.navigate(tile.url, tabId))}
                onAuxClick={(event) => event.button === 1 && void bridge?.newTab(tile.url)}
              >
                <span className="tile-icon">
                  <Favicon src={siteIconUrl(tile.url)} host={tile.host} size={22} />
                </span>
                <span className="tile-label">{tile.title === tile.host ? siteName(tile.host) : tile.title}</span>
              </button>
            ))}
          </nav>
        ) : null}

        <section className={studySession ? 'newtab-focus active' : 'newtab-focus'} aria-label="Study Mode">
          <span className="newtab-focus-icon">
            <Timer size={20} strokeWidth={1.9} />
          </span>
          {studySession ? (
            <>
              <span className="newtab-focus-text">
                <strong>
                  {studySession.endsAt !== null ? `${formatCountdown(studySession.endsAt - now)} left in your focus session` : `Studying for ${formatElapsed(now - studySession.startedAt)}`}
                </strong>
                <span>Distracting pages are blocked until you finish.</span>
              </span>
              <button type="button" className="button" onClick={onOpenStudyPanel}>
                Session details
              </button>
            </>
          ) : (
            <>
              <span className="newtab-focus-text">
                <strong>Ready to focus?</strong>
                <span>Study Mode blocks distractions and keeps lectures, docs and courses open.</span>
              </span>
              <div className="settings-actions">
                <button type="button" className="button" onClick={() => onStartStudy(25)}>
                  25 min
                </button>
                <button type="button" className="button primary" onClick={() => onStartStudy(50)}>
                  Focus 50 min
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
