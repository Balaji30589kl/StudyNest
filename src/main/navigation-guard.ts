import type { BlockedNavigationInfo } from '../shared/ipc.js';

/**
 * Extension point that lets a higher layer (Study Mode today) veto top-level
 * navigations without the browser shell knowing anything about the policy.
 */
export type GuardDecision =
  | { kind: 'allow' }
  /** Drop the navigation silently. */
  | { kind: 'cancel' }
  /** Drop the navigation and load a different URL in the same tab instead. */
  | { kind: 'redirect'; url: string }
  /** Drop the navigation and show an interstitial page in its place. */
  | { kind: 'intercept'; interstitialUrl: string; blocked: BlockedNavigationInfo }
  /**
   * Not decided yet. Show `checkingUrl` while `ready` settles, then navigate to
   * the original URL again (the guard will answer synchronously by then).
   */
  | { kind: 'defer'; checkingUrl: string; ready: Promise<void> };

export type CommittedPage = {
  tabId: string;
  url: string;
  title: string;
  isActiveTab: boolean;
};

export interface NavigationGuard {
  /** Called for every top-level http(s) request before it is sent. */
  evaluateNavigation(url: string, tabId: string): GuardDecision;
  /** Side-effect-free check used when re-validating already open tabs. */
  isAllowed(url: string): boolean;
  /** Called after a top-level navigation commits to a normal page. */
  onPageCommitted?(page: CommittedPage): void;
  /** Called when the foreground page changes (tab switch, navigation, close). */
  onActivePageChanged?(url: string | null): void;
}

const INTERSTITIAL_PREFIX = 'data:text/html;charset=UTF-8,';
const INTERSTITIAL_FRAGMENT_KEYS = {
  blocked: 'studynest-blocked=',
  error: 'studynest-error=',
  checking: 'studynest-checking='
} as const;

export type InterstitialKind = keyof typeof INTERSTITIAL_FRAGMENT_KEYS;

/**
 * Packs guard-provided HTML into a data URL whose fragment records the page it
 * replaced, so the shell can map any interstitial in history back to its target.
 */
export function wrapInterstitialHtml(html: string, targetUrl: string, kind: InterstitialKind = 'blocked'): string {
  return `${INTERSTITIAL_PREFIX}${encodeURIComponent(html)}#${INTERSTITIAL_FRAGMENT_KEYS[kind]}${encodeURIComponent(targetUrl)}`;
}

/** Recognizes shell interstitials (block pages and error pages) and the URL each replaced. */
export function parseInterstitial(url: string): { target: string; kind: InterstitialKind } | null {
  if (!url.startsWith(INTERSTITIAL_PREFIX)) {
    return null;
  }

  for (const kind of Object.keys(INTERSTITIAL_FRAGMENT_KEYS) as InterstitialKind[]) {
    const marker = `#${INTERSTITIAL_FRAGMENT_KEYS[kind]}`;
    const markerIndex = url.lastIndexOf(marker);
    if (markerIndex !== -1) {
      try {
        return { target: decodeURIComponent(url.slice(markerIndex + marker.length)), kind };
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function parseInterstitialTarget(url: string): string | null {
  return parseInterstitial(url)?.target ?? null;
}
