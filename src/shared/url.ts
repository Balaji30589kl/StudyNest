import { internalPageOf, isInternalUrl, NEW_TAB_URL } from './internal-pages.js';
import { DEFAULT_SEARCH_ENGINE, getSearchEngine, SEARCH_ENGINES, SearchEngineId } from './search-engines.js';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export type NavigationClassification = 'empty' | 'search' | 'url';

export function buildSearchUrl(query: string, engine: SearchEngineId = DEFAULT_SEARCH_ENGINE): string {
  return `${getSearchEngine(engine).searchBase}${encodeURIComponent(query.trim())}`;
}

export function classifyNavigationInput(input: string): NavigationClassification {
  const trimmed = input.trim();

  if (trimmed.length === 0) {
    return 'empty';
  }

  if (trimmed.startsWith('about:') || isInternalUrl(trimmed)) {
    return 'url';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return 'url';
  }

  if (/\s/.test(trimmed)) {
    return 'search';
  }

  const looksLikeAddress =
    trimmed.includes('.') ||
    trimmed.includes('/') ||
    trimmed.includes(':') ||
    trimmed === 'localhost' ||
    /^(\d{1,3}\.){3}\d{1,3}(?::\d+)?$/.test(trimmed);

  if (!looksLikeAddress) {
    return 'search';
  }

  try {
    const parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    return ALLOWED_PROTOCOLS.has(parsed.protocol) ? 'url' : 'search';
  } catch {
    return 'search';
  }
}

/** The query of any supported search engine's results page, or null. */
export function extractSearchQueryFromUrl(input: string): string | null {
  try {
    const parsed = new URL(input);
    const host = parsed.hostname.replace(/^www\./, '');
    const engine = SEARCH_ENGINES.find((candidate) => candidate.host === host && parsed.pathname === candidate.path);
    if (!engine) {
      return null;
    }
    const query = parsed.searchParams.get(engine.param);
    return query ? query.trim() : null;
  } catch {
    return null;
  }
}

export function normalizeNavigationInput(input: string, engine: SearchEngineId = DEFAULT_SEARCH_ENGINE): string {
  const trimmed = input.trim();

  if (trimmed.length === 0) {
    return NEW_TAB_URL;
  }

  if (trimmed.startsWith('about:')) {
    return trimmed;
  }

  if (isInternalUrl(trimmed)) {
    return trimmed.toLowerCase().startsWith('studynest://') ? `studynest://${trimmed.slice('studynest://'.length)}` : trimmed;
  }

  if (classifyNavigationInput(trimmed) === 'search') {
    return buildSearchUrl(trimmed, engine);
  }

  try {
    const parsed = new URL(trimmed);
    if (ALLOWED_PROTOCOLS.has(parsed.protocol)) {
      return parsed.toString();
    }
  } catch {
    // Fall through to protocol inference.
  }

  try {
    return new URL(`https://${trimmed}`).toString();
  } catch {
    return buildSearchUrl(trimmed, engine);
  }
}

export function isSafeNavigationUrl(input: string): boolean {
  if (isInternalUrl(input)) {
    return true;
  }
  try {
    const parsed = new URL(input);
    return ALLOWED_PROTOCOLS.has(parsed.protocol) || parsed.protocol === 'about:';
  } catch {
    return false;
  }
}

/** What the address bar shows for a URL when it is not being edited. */
export function displayUrl(input: string): string {
  if (input === 'about:blank' || internalPageOf(input) === 'newtab') {
    return '';
  }

  if (isInternalUrl(input)) {
    return input.split('#', 1)[0]!;
  }

  try {
    const parsed = new URL(input);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
  } catch {
    // Return the original input when it is not a valid URL.
  }

  return input;
}

/** Host without "www.", for labels; the input itself when it is not a web URL. */
export function hostLabel(input: string): string {
  try {
    const parsed = new URL(input);
    return ALLOWED_PROTOCOLS.has(parsed.protocol) ? parsed.hostname.replace(/^www\./, '') || input : input;
  } catch {
    return input;
  }
}
