import { BrowserTabState } from '../../shared/ipc.js';
import { classifyNavigationInput, displayUrl, normalizeNavigationInput } from '../../shared/url.js';

export type OmniboxSuggestionKind = 'search' | 'url' | 'tab' | 'history' | 'remote-search';

export type OmniboxSuggestion = {
  id: string;
  kind: OmniboxSuggestionKind;
  label: string;
  detail: string;
  value: string;
};

const MAX_SUGGESTIONS = 6;
const REMOTE_SUGGESTION_LIMIT = 4;
const TAB_SUGGESTION_LIMIT = 3;
const HISTORY_SUGGESTION_LIMIT = 3;

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function isMatch(value: string, query: string): boolean {
  const normalizedValue = normalizeText(value);
  const normalizedQuery = normalizeText(query);

  if (normalizedQuery.length === 0) {
    return true;
  }

  return normalizedValue.includes(normalizedQuery);
}

function pushSuggestion(suggestions: OmniboxSuggestion[], suggestion: OmniboxSuggestion): void {
  if (suggestions.some((existing) => existing.value === suggestion.value && existing.kind === suggestion.kind)) {
    return;
  }

  suggestions.push(suggestion);
}

function createSearchSuggestion(query: string): OmniboxSuggestion {
  return {
    id: `search:${query}`,
    kind: 'search',
    label: `Search "${query}"`,
    detail: 'DuckDuckGo results',
    value: query
  };
}

function createUrlSuggestion(input: string): OmniboxSuggestion {
  const normalizedUrl = normalizeNavigationInput(input);
  return {
    id: `url:${normalizedUrl}`,
    kind: 'url',
    label: `Go to ${displayUrl(normalizedUrl)}`,
    detail: 'Open this page',
    value: normalizedUrl
  };
}

function createTabSuggestion(tab: BrowserTabState): OmniboxSuggestion {
  return {
    id: `tab:${tab.id}`,
    kind: 'tab',
    label: tab.title,
    detail: displayUrl(tab.url),
    value: tab.url
  };
}

function createHistorySuggestion(entry: string): OmniboxSuggestion {
  const normalized = normalizeNavigationInput(entry);

  return {
    id: `history:${entry}`,
    kind: 'history',
    label: entry,
    detail: displayUrl(normalized),
    value: entry
  };
}

function createRemoteSuggestion(value: string): OmniboxSuggestion {
  return {
    id: `remote:${value}`,
    kind: 'remote-search',
    label: value,
    detail: 'Search suggestion',
    value
  };
}

export async function fetchDuckDuckGoSuggestions(query: string, signal?: AbortSignal): Promise<string[]> {
  const trimmed = query.trim();

  if (trimmed.length < 2) {
    return [];
  }

  const response = await fetch(`https://duckduckgo.com/ac/?q=${encodeURIComponent(trimmed)}&type=list`, {
    method: 'GET',
    signal,
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as Array<{ phrase?: string }>;
  return payload
    .map((entry) => entry.phrase?.trim())
    .filter((phrase): phrase is string => typeof phrase === 'string' && phrase.length > 0)
    .slice(0, REMOTE_SUGGESTION_LIMIT);
}

export function buildOmniboxSuggestions(
  input: string,
  tabs: BrowserTabState[],
  recentEntries: string[],
  remoteSuggestions: string[]
): OmniboxSuggestion[] {
  const trimmed = input.trim();
  const suggestions: OmniboxSuggestion[] = [];

  if (trimmed.length > 0) {
    const classification = classifyNavigationInput(trimmed);
    if (classification === 'search') {
      pushSuggestion(suggestions, createSearchSuggestion(trimmed));
    } else {
      pushSuggestion(suggestions, createUrlSuggestion(trimmed));
    }
  }

  const query = normalizeText(trimmed);
  const matchingTabs = tabs.filter((tab) => isMatch(tab.title, query) || isMatch(tab.url, query)).slice(0, TAB_SUGGESTION_LIMIT);
  for (const tab of matchingTabs) {
    pushSuggestion(suggestions, createTabSuggestion(tab));
  }

  const matchingHistory = recentEntries.filter((entry) => isMatch(entry, query)).slice(0, HISTORY_SUGGESTION_LIMIT);
  for (const entry of matchingHistory) {
    pushSuggestion(suggestions, createHistorySuggestion(entry));
  }

  for (const suggestion of remoteSuggestions.slice(0, REMOTE_SUGGESTION_LIMIT)) {
    pushSuggestion(suggestions, createRemoteSuggestion(suggestion));
  }

  return suggestions.slice(0, MAX_SUGGESTIONS);
}

export function toSearchSubmissionValue(suggestion: OmniboxSuggestion): string {
  if (suggestion.kind === 'search' || suggestion.kind === 'remote-search' || suggestion.kind === 'history') {
    return suggestion.value;
  }

  return normalizeNavigationInput(suggestion.value);
}

export function createRecentEntryList(existingEntries: string[], value: string, limit = 8): string[] {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    return existingEntries;
  }

  const filtered = existingEntries.filter((entry) => normalizeText(entry) !== normalizeText(normalizedValue));
  return [normalizedValue, ...filtered].slice(0, limit);
}
