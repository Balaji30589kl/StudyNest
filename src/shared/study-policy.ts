import { Classification, DEFAULT_DISTRACTING_CATEGORIES, isPageCategory, PAGE_CATEGORIES, PageCategory } from './classification.js';

/**
 * Deterministic Study Mode policy.
 *
 * Pure functions only: no Electron, no storage, no network. The rules come
 * from backend policy files (block list, allow list, classification config);
 * users cannot edit them. The main process feeds these functions the policy
 * and any cached AI prediction and acts on the returned decision.
 */

export type ClassificationPolicy = {
  enabled: boolean;
  /** Minimum confidence before a "distracting" prediction blocks a page. */
  minConfidence: number;
  distractingCategories: PageCategory[];
  /** Hosts judged page by page (each video separately) instead of once per site. */
  perPageHosts: string[];
};

export type StudyPolicy = {
  block: string[];
  allow: string[];
  classification: ClassificationPolicy;
};

/** User-level preferences. Rules are not user settings. */
export type StudySettings = {
  defaultDurationMinutes: number;
};

export type PolicyAction = 'allow' | 'block' | 'check';

export type PolicyReason =
  | 'study-off'
  | 'internal'
  | 'allowlisted'
  | 'blocklisted'
  | 'classified'
  | 'unclassified'
  | 'ai-disabled';

export type PolicyDecision = {
  action: PolicyAction;
  reason: PolicyReason;
  host: string | null;
  matchedRule: string | null;
  /** Present when an AI prediction decided the outcome. */
  classification?: Pick<Classification, 'category' | 'confidence' | 'providerId'>;
};

export type PolicyContext = {
  studyActive: boolean;
  policy: StudyPolicy;
  /** Cached prediction for this page (see classificationKey), if any. */
  classification?: Classification | null;
};

export const MIN_SESSION_MINUTES = 5;
export const MAX_SESSION_MINUTES = 240;
const MAX_RULES = 2000;
const MAX_RULE_LENGTH = 300;

export const DEFAULT_CLASSIFICATION_POLICY: ClassificationPolicy = {
  enabled: true,
  minConfidence: 0.6,
  distractingCategories: [...DEFAULT_DISTRACTING_CATEGORIES],
  perPageHosts: ['youtube.com', 'youtu.be', 'vimeo.com']
};

/** Built-in fallback used only if the policy files are missing or unreadable. */
export const FALLBACK_POLICY: StudyPolicy = {
  block: ['facebook.com', 'instagram.com', 'tiktok.com', 'x.com', 'twitter.com', 'reddit.com', 'netflix.com', 'youtube.com/shorts'],
  allow: ['duckduckgo.com', 'wikipedia.org', 'khanacademy.org', 'stackoverflow.com', 'github.com', 'developer.mozilla.org'],
  classification: DEFAULT_CLASSIFICATION_POLICY
};

export const DEFAULT_STUDY_SETTINGS: StudySettings = { defaultDurationMinutes: 25 };

// Rules -----------------------------------------------------------------------

export type ParsedRule = { host: string; path: string };

export function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
}

function isValidHost(host: string): boolean {
  if (host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return true;
  }
  return (
    /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) &&
    host.split('.').every((label) => label.length > 0 && !label.startsWith('-') && !label.endsWith('-'))
  );
}

/**
 * Parses "youtube.com/shorts", "https://www.YouTube.com/shorts/", or
 * "*.reddit.com" into a host plus an optional lowercase path prefix.
 */
export function parseRule(input: string): ParsedRule | null {
  let value = input.trim();
  if (value.length === 0 || value.length > MAX_RULE_LENGTH) {
    return null;
  }
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^\*\./, '');
  value = value.split(/[?#]/, 1)[0] ?? '';
  const slash = value.indexOf('/');
  const hostPart = slash === -1 ? value : value.slice(0, slash);
  const pathPart = slash === -1 ? '' : value.slice(slash);
  const host = normalizeHost(hostPart.replace(/:\d+$/, ''));
  if (!isValidHost(host)) {
    return null;
  }
  const path = pathPart.toLowerCase().replace(/\/+$/, '');
  return { host, path };
}

export function formatRule(rule: ParsedRule): string {
  return `${rule.host}${rule.path}`;
}

export function normalizeRuleList(entries: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== 'string') continue;
    const rule = parseRule(entry);
    if (!rule) continue;
    const formatted = formatRule(rule);
    if (!seen.has(formatted)) {
      seen.add(formatted);
      result.push(formatted);
    }
    if (result.length >= MAX_RULES) break;
  }
  return result;
}

/** Host suffix match plus a path-prefix match on segment boundaries. */
export function ruleMatches(rule: ParsedRule, host: string, pathname: string): boolean {
  if (host !== rule.host && !host.endsWith(`.${rule.host}`)) {
    return false;
  }
  if (rule.path === '') {
    return true;
  }
  const path = pathname.toLowerCase();
  return path === rule.path || path.startsWith(`${rule.path}/`);
}

function specificity(rule: ParsedRule): number {
  return rule.host.length * 1000 + rule.path.length;
}

function mostSpecificMatch(rules: readonly string[], host: string, pathname: string): { rule: string; score: number } | null {
  let best: { rule: string; score: number } | null = null;
  for (const raw of rules) {
    const rule = parseRule(raw);
    if (rule && ruleMatches(rule, host, pathname)) {
      const score = specificity(rule);
      if (!best || score > best.score) {
        best = { rule: raw, score };
      }
    }
  }
  return best;
}

function parseWebUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
}

export function getPolicyHost(url: string): string | null {
  const parsed = parseWebUrl(url);
  return parsed ? normalizeHost(parsed.hostname) : null;
}

function hostIsIn(host: string, hosts: readonly string[]): boolean {
  return hosts.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

/**
 * The cache key for a prediction. Sites in `perPageHosts` are judged per page
 * (YouTube per video id); every other site is judged once.
 */
export function classificationKey(url: string, policy: ClassificationPolicy): string | null {
  const parsed = parseWebUrl(url);
  if (!parsed) {
    return null;
  }
  const host = normalizeHost(parsed.hostname);
  if (!hostIsIn(host, policy.perPageHosts)) {
    return host;
  }
  if (host === 'youtu.be') {
    const id = parsed.pathname.slice(1).split('/')[0];
    return id ? `youtube.com/watch?v=${id}` : 'youtube.com';
  }
  if (host.endsWith('youtube.com') && parsed.pathname === '/watch') {
    const id = parsed.searchParams.get('v');
    return id ? `youtube.com/watch?v=${id}` : `${host}/watch`;
  }
  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  return `${host}${path}${contentQuery(parsed.searchParams)}`;
}

/** Query parameters that track or position, rather than identify content. */
const NON_CONTENT_PARAMS = /^(utm_.*|fbclid|gclid|mc_.*|ref|ref_src|si|feature|t|time_continue|start|pp|ab_channel|source|themerefresh)$/i;

function contentQuery(params: URLSearchParams): string {
  const kept = [...params.entries()].filter(([name]) => !NON_CONTENT_PARAMS.test(name)).sort(([a], [b]) => a.localeCompare(b));
  return kept.length > 0 ? `?${new URLSearchParams(kept).toString()}` : '';
}

// Decisions -------------------------------------------------------------------

/**
 * Decides what Study Mode does with a top-level navigation.
 *
 * Order: Study Mode off → internal pages → most specific list rule (block wins
 * ties) → cached AI prediction → "check" (classify before rendering).
 */
export function evaluateStudyPolicy(url: string, context: PolicyContext): PolicyDecision {
  const parsed = parseWebUrl(url);
  const host = parsed ? normalizeHost(parsed.hostname) : null;

  if (!context.studyActive) {
    return { action: 'allow', reason: 'study-off', host, matchedRule: null };
  }
  if (!parsed || !host) {
    return { action: 'allow', reason: 'internal', host: null, matchedRule: null };
  }

  const { policy } = context;
  const block = mostSpecificMatch(policy.block, host, parsed.pathname);
  const allow = mostSpecificMatch(policy.allow, host, parsed.pathname);
  if (block && (!allow || block.score >= allow.score)) {
    return { action: 'block', reason: 'blocklisted', host, matchedRule: block.rule };
  }
  if (allow) {
    return { action: 'allow', reason: 'allowlisted', host, matchedRule: allow.rule };
  }

  const ai = policy.classification;
  if (!ai.enabled) {
    return { action: 'allow', reason: 'ai-disabled', host, matchedRule: null };
  }

  const prediction = context.classification ?? null;
  if (!prediction) {
    return { action: 'check', reason: 'unclassified', host, matchedRule: null };
  }

  const distracting = ai.distractingCategories.includes(prediction.category) && prediction.confidence >= ai.minConfidence;
  return {
    action: distracting ? 'block' : 'allow',
    reason: 'classified',
    host,
    matchedRule: null,
    classification: { category: prediction.category, confidence: prediction.confidence, providerId: prediction.providerId }
  };
}

// Validation ------------------------------------------------------------------

function readList(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object' && raw !== null && Array.isArray((raw as { rules?: unknown }).rules)) {
    return (raw as { rules: unknown[] }).rules;
  }
  return null;
}

export function sanitizeClassificationPolicy(raw: unknown, base: ClassificationPolicy = DEFAULT_CLASSIFICATION_POLICY): ClassificationPolicy {
  const candidate = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const confidence = typeof candidate.minConfidence === 'number' && Number.isFinite(candidate.minConfidence) ? candidate.minConfidence : base.minConfidence;
  const categories = Array.isArray(candidate.distractingCategories)
    ? PAGE_CATEGORIES.filter((category) => (candidate.distractingCategories as unknown[]).includes(category))
    : base.distractingCategories.filter(isPageCategory);
  const hosts = Array.isArray(candidate.perPageHosts)
    ? normalizeRuleList(candidate.perPageHosts).map((rule) => parseRule(rule)!.host)
    : [...base.perPageHosts];
  return {
    enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : base.enabled,
    minConfidence: Math.min(0.99, Math.max(0, confidence)),
    distractingCategories: categories,
    perPageHosts: [...new Set(hosts)]
  };
}

/** Validates policy files (from disk or the gateway). Missing parts fall back to the base. */
export function sanitizeStudyPolicy(raw: { block?: unknown; allow?: unknown; classification?: unknown }, base: StudyPolicy = FALLBACK_POLICY): StudyPolicy {
  const block = readList(raw.block);
  const allow = readList(raw.allow);
  return {
    block: block ? normalizeRuleList(block) : [...base.block],
    allow: allow ? normalizeRuleList(allow) : [...base.allow],
    classification: raw.classification === undefined ? { ...base.classification } : sanitizeClassificationPolicy(raw.classification, base.classification)
  };
}

export function clampSessionMinutes(value: unknown, fallback = DEFAULT_STUDY_SETTINGS.defaultDurationMinutes): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(MAX_SESSION_MINUTES, Math.max(MIN_SESSION_MINUTES, Math.round(numeric)));
}

export function sanitizeStudySettings(input: unknown, base: StudySettings = DEFAULT_STUDY_SETTINGS): StudySettings {
  const candidate = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  return {
    defaultDurationMinutes:
      candidate.defaultDurationMinutes === undefined
        ? base.defaultDurationMinutes
        : clampSessionMinutes(candidate.defaultDurationMinutes, base.defaultDurationMinutes)
  };
}

export function describePolicyReason(reason: PolicyReason): string {
  switch (reason) {
    case 'blocklisted':
      return 'This site is on the StudyNest block list.';
    case 'classified':
      return "StudyNest checked this page and it doesn't look like study material.";
    case 'allowlisted':
      return 'This site is on the StudyNest allow list.';
    case 'unclassified':
      return 'This page is being checked.';
    case 'ai-disabled':
      return 'Page checks are turned off.';
    case 'internal':
      return 'Internal StudyNest page.';
    case 'study-off':
      return 'Study Mode is off.';
  }
}
