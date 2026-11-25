/** Search engines the address bar can use. DuckDuckGo is the default (no tracking). */

export type SearchEngineId = 'duckduckgo' | 'google' | 'bing' | 'brave' | 'ecosia';

export type SearchEngine = {
  id: SearchEngineId;
  name: string;
  /** Results page; the query is appended URL-encoded. */
  searchBase: string;
  /** Host and query parameter used to recognise this engine's results pages. */
  host: string;
  path: string;
  param: string;
};

export const SEARCH_ENGINES: readonly SearchEngine[] = [
  { id: 'duckduckgo', name: 'DuckDuckGo', searchBase: 'https://duckduckgo.com/?q=', host: 'duckduckgo.com', path: '/', param: 'q' },
  { id: 'google', name: 'Google', searchBase: 'https://www.google.com/search?q=', host: 'google.com', path: '/search', param: 'q' },
  { id: 'bing', name: 'Bing', searchBase: 'https://www.bing.com/search?q=', host: 'bing.com', path: '/search', param: 'q' },
  { id: 'brave', name: 'Brave Search', searchBase: 'https://search.brave.com/search?q=', host: 'search.brave.com', path: '/search', param: 'q' },
  { id: 'ecosia', name: 'Ecosia', searchBase: 'https://www.ecosia.org/search?q=', host: 'ecosia.org', path: '/search', param: 'q' }
];

export const DEFAULT_SEARCH_ENGINE: SearchEngineId = 'duckduckgo';

export function isSearchEngineId(value: unknown): value is SearchEngineId {
  return typeof value === 'string' && SEARCH_ENGINES.some((engine) => engine.id === value);
}

export function getSearchEngine(id: SearchEngineId | undefined): SearchEngine {
  return SEARCH_ENGINES.find((engine) => engine.id === id) ?? SEARCH_ENGINES[0]!;
}
