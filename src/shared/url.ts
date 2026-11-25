import { isStudyNestLandingPageUrl } from './landing-page.js';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const SEARCH_BASE = 'https://duckduckgo.com/?q=';
const SEARCH_HOSTS = new Set(['duckduckgo.com']);

export type NavigationClassification = 'empty' | 'search' | 'url';

export function buildSearchUrl(query: string): string {
  return `${SEARCH_BASE}${encodeURIComponent(query.trim())}`;
}

export function classifyNavigationInput(input: string): NavigationClassification {
  const trimmed = input.trim();

  if (trimmed.length === 0) {
    return 'empty';
  }

  if (trimmed.startsWith('about:')) {
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

export function extractSearchQueryFromUrl(input: string): string | null {
  try {
    const parsed = new URL(input);

    if (!SEARCH_HOSTS.has(parsed.hostname)) {
      return null;
    }

    const query = parsed.searchParams.get('q');
    return query ? query.trim() : null;
  } catch {
    return null;
  }
}

export function normalizeNavigationInput(input: string): string {
  const trimmed = input.trim();

  if (trimmed.length === 0) {
    return 'about:blank';
  }

  if (trimmed.startsWith('about:')) {
    return trimmed;
  }

  if (classifyNavigationInput(trimmed) === 'search') {
    return buildSearchUrl(trimmed);
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
    return buildSearchUrl(trimmed);
  }
}

export function isSafeNavigationUrl(input: string): boolean {
  try {
    const parsed = new URL(input);
    return ALLOWED_PROTOCOLS.has(parsed.protocol) || parsed.protocol === 'about:';
  } catch {
    return false;
  }
}

export function displayUrl(input: string): string {
  if (input === 'about:blank') {
    return 'New tab';
  }

  if (isStudyNestLandingPageUrl(input)) {
    return 'StudyNest Start';
  }

  const searchQuery = extractSearchQueryFromUrl(input);
  if (searchQuery) {
    return searchQuery;
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