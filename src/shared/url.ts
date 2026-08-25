const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const SEARCH_BASE = 'https://duckduckgo.com/?q=';

export function normalizeNavigationInput(input: string): string {
  const trimmed = input.trim();

  if (trimmed.length === 0) {
    return 'about:blank';
  }

  if (trimmed.startsWith('about:')) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (ALLOWED_PROTOCOLS.has(parsed.protocol)) {
      return parsed.toString();
    }
  } catch {
    // Fall through to URL inference.
  }

  if (/\s/.test(trimmed)) {
    return `${SEARCH_BASE}${encodeURIComponent(trimmed)}`;
  }

  try {
    return new URL(`https://${trimmed}`).toString();
  } catch {
    return `${SEARCH_BASE}${encodeURIComponent(trimmed)}`;
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

  return input;
}