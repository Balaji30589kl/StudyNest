import { Bookmark as BookmarkIcon, Clock, Globe, Layers, Search } from 'lucide-react';
import { ReactNode, useEffect, useState } from 'react';
import type { Bookmark, BrowserTabState } from '../../../shared/ipc.js';
import { getSearchEngine, SearchEngineId } from '../../../shared/search-engines.js';
import { buildOmniboxSuggestions, fetchSearchSuggestions, OmniboxSuggestion } from '../omnibox.js';

export const bridge = typeof window !== 'undefined' && window.studyNest ? window.studyNest : null;

function letterFor(host: string): string {
  const name = host.replace(/^www\./, '').split('.')[0] ?? '';
  return (name[0] ?? '•').toUpperCase();
}

/** A site's icon, or its first letter when the site has none (or it fails to load). */
export function Favicon({ src, host, size = 16 }: { src?: string | null; host: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (src && !failed) {
    return <img className="favicon" src={src} alt="" width={size} height={size} onError={() => setFailed(true)} draggable={false} />;
  }
  return (
    <span className="favicon letter" aria-hidden="true" style={{ width: size, height: size }}>
      {letterFor(host)}
    </span>
  );
}

/** StudyNest mark: a nest (open bowl) holding a leaf. */
export function BrandMark({ className = 'brand-mark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M5 15c0 6.1 4.9 11 11 11s11-4.9 11-11" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M9 19.5c2 1.6 4.4 2.5 7 2.5s5-.9 7-2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.55" />
      <path d="M16 17.5c-3.6-1.2-5.2-4.4-4.4-9.3 4.5.6 6.6 3.6 4.4 9.3Z" fill="currentColor" />
      <path d="M16 17.5c2.2-2.4 4.9-3.4 8-3-.6 3.2-3.4 4.6-8 3Z" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

const KIND_ICON = {
  search: Search,
  suggestion: Search,
  url: Globe,
  tab: Layers,
  bookmark: BookmarkIcon,
  history: Clock
} as const;

/** Bold the typed words inside a suggestion title. */
function highlight(text: string, query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return text;
  const lower = text.toLowerCase();
  const marks: Array<[number, number]> = [];
  for (const word of words) {
    let from = 0;
    while (from < lower.length) {
      const at = lower.indexOf(word, from);
      if (at === -1) break;
      marks.push([at, at + word.length]);
      from = at + word.length;
    }
  }
  if (marks.length === 0) return text;
  marks.sort((a, b) => a[0] - b[0]);
  const parts: Array<string | ReactNode> = [];
  let cursor = 0;
  marks.forEach(([start, end], index) => {
    if (start < cursor) return;
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(<mark key={index}>{text.slice(start, end)}</mark>);
    cursor = end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

export function SuggestionList({
  suggestions,
  query,
  highlighted,
  onHighlight,
  onChoose,
  className,
  style
}: {
  suggestions: OmniboxSuggestion[];
  query: string;
  highlighted: number;
  onHighlight: (index: number) => void;
  onChoose: (suggestion: OmniboxSuggestion) => void;
  className: string;
  style?: React.CSSProperties;
}) {
  if (suggestions.length === 0) return null;
  return (
    <div className={className} style={style} role="listbox" aria-label="Search suggestions">
      {suggestions.map((suggestion, index) => {
        const Icon = KIND_ICON[suggestion.kind];
        const host = (() => {
          try {
            return new URL(suggestion.url).hostname;
          } catch {
            return '';
          }
        })();
        return (
          <button
            key={suggestion.id}
            type="button"
            role="option"
            aria-selected={index === highlighted}
            className={index === highlighted ? 'omnibox-item active' : 'omnibox-item'}
            onMouseDown={(event) => event.preventDefault()}
            onMouseMove={() => index !== highlighted && onHighlight(index)}
            onClick={() => onChoose(suggestion)}
          >
            <span className="omnibox-item-icon">
              {suggestion.kind === 'tab' && suggestion.favicon !== undefined ? <Favicon src={suggestion.favicon} host={host} /> : <Icon size={16} strokeWidth={1.75} />}
            </span>
            <span className="omnibox-item-text">
              <span className="omnibox-item-label">{highlight(suggestion.title, query)}</span>
              <span className="omnibox-item-detail">{suggestion.detail}</span>
            </span>
            {index === highlighted && suggestion.kind === 'tab' ? <span className="omnibox-item-hint">Switch</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Suggestions for typed text: open tabs and bookmarks locally, history from
 * main, and search suggestions from DuckDuckGo (debounced, can be turned off).
 */
export function useOmniboxSuggestions(options: {
  input: string;
  active: boolean;
  tabs: BrowserTabState[];
  activeTabId: string | null;
  bookmarks: Bookmark[];
  engine: SearchEngineId;
  remoteEnabled: boolean;
}): { suggestions: OmniboxSuggestion[]; historyUrls: string[] } {
  const { input, active, tabs, activeTabId, bookmarks, engine, remoteEnabled } = options;
  const [history, setHistory] = useState<Awaited<ReturnType<NonNullable<typeof bridge>['suggestHistory']>>>([]);
  const [remote, setRemote] = useState<string[]>([]);

  useEffect(() => {
    if (!active || !bridge || input.trim().length === 0) {
      setHistory([]);
      return;
    }
    let cancelled = false;
    void bridge.suggestHistory(input).then((entries) => {
      if (!cancelled) setHistory(entries);
    });
    return () => {
      cancelled = true;
    };
  }, [input, active]);

  useEffect(() => {
    setRemote([]);
    if (!active || !remoteEnabled || input.trim().length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetchSearchSuggestions(input, controller.signal)
        .then((phrases) => {
          if (!controller.signal.aborted) setRemote(phrases);
        })
        .catch(() => undefined);
    }, 120);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [input, active, remoteEnabled]);

  const suggestions = active
    ? buildOmniboxSuggestions(input, { tabs, activeTabId, bookmarks, history, remote, engine, engineName: getSearchEngine(engine).name })
    : [];
  return { suggestions, historyUrls: [...history.map((entry) => entry.url), ...bookmarks.map((bookmark) => bookmark.url)] };
}
