/**
 * Focus view: page elements hidden during Study Mode (recommendation feeds,
 * hover previews, Shorts shelves, comments…) so a study page stays a study
 * page. Rules come from the backend policy (`policy/focus.json`), like the
 * block and allow lists, so they can be updated when a site changes its layout.
 */

export type FocusRule = {
  /** Sites the rule applies to (subdomains match). */
  hosts: string[];
  /** CSS selectors of elements to hide. Selectors only: no declarations or at-rules. */
  hide: string[];
  /** Optional one-line notice shown on the page, and the element it is placed before. */
  note?: { text: string; before: string };
  /**
   * Requests refused while Study Mode runs on these sites, as "host/path" prefixes
   * (for example YouTube's animated hover thumbnails, "i.ytimg.com/an_webp/").
   */
  blockRequests?: string[];
};

const MAX_RULES = 50;
const MAX_SELECTORS = 200;
const MAX_SELECTOR_LENGTH = 200;
const MAX_NOTE_LENGTH = 160;
const MAX_REQUEST_PREFIXES = 50;

/** Built-in rules, used when the policy files have none. Kept in sync with policy/focus.json. */
export const DEFAULT_FOCUS_RULES: FocusRule[] = [
  {
    hosts: ['youtube.com'],
    // Only what plays or sells without a click is hidden. Recommendations, comments,
    // end screens and Shorts shelves stay visible: "Up next" is often the next
    // lecture, and any video opened from them is checked (and blocked) first.
    hide: [
      // Hover previews that start playing a video under the mouse.
      'ytd-video-preview',
      '#video-preview',
      'ytd-moving-thumbnail-renderer',
      '#mouseover-overlay',
      // Animated thumbnails: newer cards ("Up next") swap in a moving WebP clip on hover.
      'img[src*="/an_webp/"]',
      // Ads: in-video overlays ("Sponsored", "Shop now") and ad slots. The video ads
      // themselves are skipped by youtube-focus-script.ts.
      '.ytp-ad-player-overlay-layout',
      '.ytp-ad-overlay-container',
      '.ytp-ad-image-overlay',
      '.ytp-ad-text-overlay',
      'ytd-companion-slot-renderer',
      'ytd-ad-slot-renderer',
      'ytd-in-feed-ad-layout-renderer',
      '#player-ads',
      '#masthead-ad'
    ],
    note: { text: 'StudyNest focus view: hover previews and ads are off. Any video you open is checked first.', before: 'ytd-watch-metadata' },
    // The animated thumbnails themselves are not downloaded, whatever the page layout.
    blockRequests: ['i.ytimg.com/an_webp/']
  }
];

function normalizeHost(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const host = value.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || host === 'localhost' ? host : null;
}

/**
 * A selector is accepted only if it cannot escape into declarations, at-rules
 * or comments, so a policy file can hide elements but never inject other CSS.
 */
export function isSafeSelector(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= MAX_SELECTOR_LENGTH &&
    !/[{};@\\<]|\/\*|\*\//.test(value) &&
    // Balanced brackets and quotes.
    (value.match(/\(/g) ?? []).length === (value.match(/\)/g) ?? []).length &&
    (value.match(/\[/g) ?? []).length === (value.match(/\]/g) ?? []).length &&
    (value.match(/"/g) ?? []).length % 2 === 0 &&
    (value.match(/'/g) ?? []).length % 2 === 0
  );
}

function readRules(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object' && raw !== null && Array.isArray((raw as { rules?: unknown }).rules)) return (raw as { rules: unknown[] }).rules;
  return null;
}

/** Validates focus rules from a policy file; null when the input has no rules list. */
export function sanitizeFocusRules(raw: unknown): FocusRule[] | null {
  const list = readRules(raw);
  if (!list) return null;
  const rules: FocusRule[] = [];
  for (const entry of list.slice(0, MAX_RULES)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const candidate = entry as Record<string, unknown>;
    const hosts = Array.isArray(candidate.hosts) ? [...new Set(candidate.hosts.map(normalizeHost).filter((host): host is string => host !== null))] : [];
    const hide = Array.isArray(candidate.hide) ? [...new Set(candidate.hide.filter(isSafeSelector).map((selector) => selector.trim()))].slice(0, MAX_SELECTORS) : [];
    if (hosts.length === 0 || hide.length === 0) continue;
    const rule: FocusRule = { hosts, hide };
    const note = candidate.note as Record<string, unknown> | undefined;
    if (note && typeof note.text === 'string' && note.text.trim() && isSafeSelector(note.before)) {
      rule.note = { text: note.text.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE_LENGTH), before: note.before.trim() };
    }
    if (Array.isArray(candidate.blockRequests)) {
      const prefixes = [...new Set(candidate.blockRequests.map(normalizeRequestPrefix).filter((prefix): prefix is string => prefix !== null))].slice(0, MAX_REQUEST_PREFIXES);
      if (prefixes.length > 0) rule.blockRequests = prefixes;
    }
    rules.push(rule);
  }
  return rules;
}

/** "https://I.ytimg.com/an_webp/" → "i.ytimg.com/an_webp/"; null unless it is a host with an optional path. */
function normalizeRequestPrefix(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/^https?:\/\//i, '');
  const slash = trimmed.indexOf('/');
  const host = (slash === -1 ? trimmed : trimmed.slice(0, slash)).toLowerCase();
  const rest = slash === -1 ? '' : trimmed.slice(slash);
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || rest.length > 200 || /\s/.test(rest)) return null;
  return `${host}${rest}`;
}

/**
 * True when Study Mode should refuse a request made by a page of `pageHost`:
 * a matching rule lists a prefix of the request's "host/path".
 */
export function focusBlocksRequest(rules: FocusRule[], pageHost: string | null, requestUrl: string): boolean {
  if (!pageHost) return false;
  let target: string;
  try {
    const parsed = new URL(requestUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    target = `${parsed.hostname.toLowerCase()}${parsed.pathname}`;
  } catch {
    return false;
  }
  return rules.some((rule) => rule.blockRequests?.some((prefix) => target.startsWith(prefix)) && hostMatches(pageHost, rule.hosts));
}

function hostMatches(host: string, entries: string[]): boolean {
  const normalized = host.toLowerCase().replace(/^www\./, '');
  return entries.some((entry) => normalized === entry || normalized.endsWith(`.${entry}`));
}

/** CSS text in a CSS string literal. */
function cssString(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, ' ')}"`;
}

/** Set on <html> while Study Mode runs; the focus stylesheet applies only under it. */
export const FOCUS_ATTRIBUTE = 'data-studynest-focus';
const SCOPE = `html[${FOCUS_ATTRIBUTE}]`;

/**
 * The focus stylesheet for pages of `host`, or null when no rule applies. It is
 * scoped to `html[data-studynest-focus]`, so it only takes effect while Study
 * Mode sets that attribute. Selectors sit in a forgiving :is() list: if a site
 * renames one element, the other selectors keep working.
 */
export function focusCssFor(rules: FocusRule[], host: string | null): string | null {
  if (!host) return null;
  const matching = rules.filter((rule) => hostMatches(host, rule.hosts));
  if (matching.length === 0) return null;
  const selectors = [...new Set(matching.flatMap((rule) => rule.hide))];
  const parts = [`${SCOPE} :is(\n  ${selectors.join(',\n  ')}\n) {\n  display: none !important;\n}`];
  for (const rule of matching) {
    if (!rule.note) continue;
    parts.push(
      `${SCOPE} ${rule.note.before}::before {\n  content: ${cssString(rule.note.text)};\n  display: block;\n  margin: 12px 0;\n  padding: 10px 14px;\n  border-radius: 10px;\n  background: rgba(47, 107, 79, 0.12);\n  color: #3f8f66;\n  font: 500 13px/1.4 'Segoe UI', system-ui, sans-serif;\n}`
    );
  }
  return parts.join('\n\n');
}
