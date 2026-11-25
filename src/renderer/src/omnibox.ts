import type { Bookmark, BrowserTabState, HistorySuggestion } from '../../shared/ipc.js';
import { isInternalUrl } from '../../shared/internal-pages.js';
import { buildSearchUrl, classifyNavigationInput, displayUrl, normalizeNavigationInput } from '../../shared/url.js';
import type { SearchEngineId } from '../../shared/search-engines.js';

export type OmniboxSuggestionKind = 'search' | 'url' | 'tab' | 'bookmark' | 'history' | 'suggestion';

export type OmniboxSuggestion = {
  id: string;
  kind: OmniboxSuggestionKind;
  /** Main line: a page title or the search text. */
  title: string;
  /** Second line: the address, or what Enter will do. */
  detail: string;
  /** Where Enter goes: a URL (navigate), or the tab to switch to for kind 'tab'. */
  url: string;
  tabId?: string;
  favicon?: string | null;
};

export type OmniboxSources = {
  tabs: BrowserTabState[];
  activeTabId: string | null;
  bookmarks: Bookmark[];
  history: HistorySuggestion[];
  remote: string[];
  engine: SearchEngineId;
  engineName: string;
};

const MAX_SUGGESTIONS = 8;
const LIMITS = { tab: 2, bookmark: 3, history: 4, suggestion: 4 } as const;

function tokens(value: string): string[] {
  return value.toLowerCase().split(/\s+/).filter(Boolean);
}

function matches(haystack: string, query: string): boolean {
  const text = haystack.toLowerCase();
  return tokens(query).every((token) => text.includes(token));
}

function bareHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** The address without "https://", "www." and a trailing slash, as people type it. */
export function typedForm(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
}

/**
 * Inline autocompletion: when the typed text starts a known site's address,
 * the rest of that address ("you" → "tube.com"). Only for single words.
 */
export function inlineCompletion(input: string, candidates: string[]): string | null {
  const typed = input.trim().toLowerCase();
  if (typed.length === 0 || /\s/.test(typed) || /^https?:\/\//.test(typed)) {
    return null;
  }
  for (const url of candidates) {
    const form = typedForm(url);
    // Complete host names (and short paths after them), never into the middle of a word.
    if (form.toLowerCase().startsWith(typed) && form.length > typed.length) {
      const host = bareHost(url);
      const completion = typed.length < host.length ? host : form;
      if (completion.toLowerCase().startsWith(typed)) {
        return completion.slice(typed.length);
      }
    }
  }
  return null;
}

export async function fetchSearchSuggestions(query: string, signal?: AbortSignal): Promise<string[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2 || classifyNavigationInput(trimmed) === 'url') {
    return [];
  }
  const response = await fetch(`https://duckduckgo.com/ac/?q=${encodeURIComponent(trimmed)}&type=list`, {
    method: 'GET',
    signal,
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) {
    return [];
  }
  const payload = (await response.json()) as unknown;
  // DuckDuckGo answers either [{phrase}] or ["query", ["s1", "s2"]].
  const phrases = Array.isArray(payload)
    ? Array.isArray(payload[1])
      ? (payload[1] as unknown[])
      : payload.map((entry) => (typeof entry === 'object' && entry !== null ? (entry as { phrase?: unknown }).phrase : entry))
    : [];
  return phrases
    .filter((phrase): phrase is string => typeof phrase === 'string' && phrase.trim().length > 0)
    .map((phrase) => phrase.trim())
    .filter((phrase) => phrase.toLowerCase() !== trimmed.toLowerCase())
    .slice(0, LIMITS.suggestion);
}

/** Builds the dropdown: what you typed first, then open tabs, bookmarks, history and search suggestions. */
export function buildOmniboxSuggestions(input: string, sources: OmniboxSources): OmniboxSuggestion[] {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const result: OmniboxSuggestion[] = [];
  const seenUrls = new Set<string>();
  const push = (suggestion: OmniboxSuggestion) => {
    const key = suggestion.kind === 'tab' ? `tab:${suggestion.tabId}` : suggestion.url;
    if (seenUrls.has(key) || result.length >= MAX_SUGGESTIONS) return;
    seenUrls.add(key);
    if (suggestion.kind !== 'tab') seenUrls.add(suggestion.url);
    result.push(suggestion);
  };

  const search: OmniboxSuggestion = {
    id: `search:${trimmed}`,
    kind: 'search',
    title: trimmed,
    detail: `Search ${sources.engineName}`,
    url: buildSearchUrl(trimmed, sources.engine)
  };

  if (classifyNavigationInput(trimmed) === 'url') {
    const url = normalizeNavigationInput(trimmed, sources.engine);
    push({ id: `url:${url}`, kind: 'url', title: isInternalUrl(url) ? url : typedForm(url), detail: 'Open this address', url });
    push(search);
  } else {
    push(search);
  }

  sources.tabs
    .filter((tab) => tab.id !== sources.activeTabId && !isInternalUrl(tab.url) && matches(`${tab.title} ${tab.url}`, trimmed))
    .slice(0, LIMITS.tab)
    .forEach((tab) =>
      push({ id: `tab:${tab.id}`, kind: 'tab', title: tab.title, detail: `Switch to this tab · ${typedForm(displayUrl(tab.url))}`, url: tab.url, tabId: tab.id, favicon: tab.favicon })
    );

  sources.bookmarks
    .filter((bookmark) => matches(`${bookmark.title} ${bookmark.url}`, trimmed))
    .slice(0, LIMITS.bookmark)
    .forEach((bookmark) => push({ id: `bookmark:${bookmark.id}`, kind: 'bookmark', title: bookmark.title, detail: typedForm(bookmark.url), url: bookmark.url }));

  sources.history
    .slice(0, LIMITS.history + 2)
    .forEach((entry) => push({ id: `history:${entry.url}`, kind: 'history', title: entry.title || typedForm(entry.url), detail: typedForm(entry.url), url: entry.url }));

  sources.remote.slice(0, LIMITS.suggestion).forEach((phrase) =>
    push({ id: `suggestion:${phrase}`, kind: 'suggestion', title: phrase, detail: `Search ${sources.engineName}`, url: buildSearchUrl(phrase, sources.engine) })
  );

  return result;
}
