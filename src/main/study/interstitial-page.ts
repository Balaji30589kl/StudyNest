import type { BlockedNavigationInfo } from '../../shared/ipc.js';
import { describePolicyReason } from '../../shared/study-policy.js';
import { wrapInterstitialHtml } from '../navigation-guard.js';
import { PAGE_ICONS, PAGE_STYLE } from '../page-style.js';

export type InterstitialOptions = {
  blocked: BlockedNavigationInfo;
  /** Null for an open-ended session (Study Mode switched on without a timer). */
  sessionEndsAt: number | null;
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatEndTime(endsAt: number | null): string {
  if (!endsAt) {
    return 'Study Mode stays on until you turn it off.';
  }
  const time = new Date(endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `Your focus session ends at ${escapeHtml(time)}.`;
}

function describeClassification(blocked: BlockedNavigationInfo): string {
  const prediction = blocked.classification;
  if (!prediction) {
    return '';
  }
  if (prediction.category === 'other' && prediction.confidence < 0.6) {
    return `<p>StudyNest couldn't confirm this video is study material, so it stays blocked during Study Mode. Searching for the topic usually finds a lecture that opens.</p>`;
  }
  return `<p>StudyNest judged this page as <strong>${escapeHtml(prediction.category)}</strong> (${Math.round(prediction.confidence * 100)}% confidence).</p>`;
}

/**
 * Sites whose blocked pages offer a search box instead, so a student can still
 * find a lecture while the feed and Shorts stay blocked. Each search is
 * checked by its query like any other page, so a comedy search is blocked.
 */
const STUDY_SEARCH: Array<{ hosts: string[]; label: string; action: string; param: string }> = [
  { hosts: ['youtube.com', 'youtu.be'], label: 'Looking for a lecture? Search YouTube instead:', action: 'https://www.youtube.com/results', param: 'search_query' }
];

function searchFor(host: string) {
  return STUDY_SEARCH.find(({ hosts }) => hosts.some((entry) => host === entry || host.endsWith(`.${entry}`))) ?? null;
}

function renderSearch(host: string): string {
  const search = searchFor(host);
  if (!search) {
    return '';
  }
  return `<form class="search" action="${escapeHtml(search.action)}" method="get" role="search">
<label for="study-search">${escapeHtml(search.label)}</label>
<div class="search-row"><input id="study-search" name="${escapeHtml(search.param)}" type="search" placeholder="e.g. linear algebra lecture" autocomplete="off" required autofocus /><button type="submit" class="primary">Search</button></div>
</form>`;
}

export function buildInterstitialHtml({ blocked, sessionEndsAt }: InterstitialOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Blocked - StudyNest</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<main>
<div class="icon danger" aria-hidden="true">${PAGE_ICONS.shield}</div>
<p class="eyebrow">Study Mode</p>
<h1>Blocked during Study Mode</h1>
<p class="host">${escapeHtml(blocked.host)}</p>
<p>${escapeHtml(describePolicyReason(blocked.reason))}</p>
${describeClassification(blocked)}
<p>${formatEndTime(sessionEndsAt)}</p>
${renderSearch(blocked.host)}
<div class="actions"><button type="button" onclick="history.length > 1 ? history.back() : null">Go back</button></div>
</main>
</body>
</html>`;
}

export function buildInterstitialUrl(options: InterstitialOptions): string {
  return wrapInterstitialHtml(buildInterstitialHtml(options), options.blocked.url);
}

/** Shown while a page is classified before it is allowed to render. */
export function buildCheckingHtml(host: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Checking page…</title>
<style>${PAGE_STYLE}
main { text-align: center; margin-top: 24vh; }
.spinner { margin: 0 auto 20px; }
</style>
</head>
<body>
<main>
<div class="spinner" aria-hidden="true"></div>
<h1>Checking this page…</h1>
<p class="host">${escapeHtml(host)}</p>
<p>Study Mode is making sure it's study material before it opens.</p>
</main>
</body>
</html>`;
}

export function buildCheckingUrl(url: string, host: string): string {
  return wrapInterstitialHtml(buildCheckingHtml(host), url, 'checking');
}
