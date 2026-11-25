import { DEFAULT_SEARCH_ENGINE, isSearchEngineId, SearchEngineId } from './search-engines.js';

export type ThemePreference = 'system' | 'light' | 'dark';
export type StartupBehavior = 'restore' | 'new-tab';

export type BrowserSettings = {
  theme: ThemePreference;
  searchEngine: SearchEngineId;
  /** Reopen last session's tabs, or start with one new tab. */
  startup: StartupBehavior;
  showBookmarksBar: boolean;
  /** Block ads and trackers on every site except `adBlockExceptions`. */
  adBlocking: boolean;
  /** Hosts where the ad blocker is switched off by the user. */
  adBlockExceptions: string[];
  /** Fetch search suggestions while typing in the address bar. */
  searchSuggestions: boolean;
};

export const DEFAULT_BROWSER_SETTINGS: BrowserSettings = {
  theme: 'system',
  searchEngine: DEFAULT_SEARCH_ENGINE,
  startup: 'restore',
  showBookmarksBar: true,
  adBlocking: true,
  adBlockExceptions: [],
  searchSuggestions: true
};

const MAX_EXCEPTIONS = 500;

function normalizeHost(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const host = value.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || host === 'localhost' ? host : null;
}

/** Validates stored or incoming settings; anything missing or invalid keeps the base value. */
export function sanitizeBrowserSettings(raw: unknown, base: BrowserSettings = DEFAULT_BROWSER_SETTINGS): BrowserSettings {
  const candidate = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const pick = <K extends keyof BrowserSettings>(key: K, valid: (value: unknown) => boolean): BrowserSettings[K] =>
    valid(candidate[key]) ? (candidate[key] as BrowserSettings[K]) : base[key];
  const exceptions = Array.isArray(candidate.adBlockExceptions)
    ? [...new Set(candidate.adBlockExceptions.map(normalizeHost).filter((host): host is string => host !== null))].slice(0, MAX_EXCEPTIONS)
    : [...base.adBlockExceptions];

  return {
    theme: pick('theme', (value) => value === 'system' || value === 'light' || value === 'dark'),
    searchEngine: pick('searchEngine', isSearchEngineId),
    startup: pick('startup', (value) => value === 'restore' || value === 'new-tab'),
    showBookmarksBar: pick('showBookmarksBar', (value) => typeof value === 'boolean'),
    adBlocking: pick('adBlocking', (value) => typeof value === 'boolean'),
    adBlockExceptions: exceptions,
    searchSuggestions: pick('searchSuggestions', (value) => typeof value === 'boolean')
  };
}

/** True when the ad blocker should run on pages of `host`. */
export function adBlockingActiveFor(settings: BrowserSettings, host: string | null): boolean {
  if (!settings.adBlocking) return false;
  if (!host) return true;
  const normalized = host.toLowerCase().replace(/^www\./, '');
  return !settings.adBlockExceptions.some((entry) => normalized === entry || normalized.endsWith(`.${entry}`));
}
