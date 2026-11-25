import type { BlockedNavigationInfo } from '../../shared/ipc.js';
import { describePolicyReason } from '../../shared/study-policy.js';
import { wrapInterstitialHtml } from '../navigation-guard.js';

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

const BASE_STYLE = `:root { color-scheme: dark; font-family: Inter, system-ui, -apple-system, 'Segoe UI', sans-serif; }
html, body { margin: 0; height: 100%; }
body { display: grid; place-items: center; background: linear-gradient(180deg, #0b1020, #0f172a); color: #e5eefc; }
main { width: min(560px, calc(100vw - 48px)); padding: 36px; border-radius: 24px; background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(148, 163, 184, 0.18); box-shadow: 0 30px 80px rgba(2, 6, 23, 0.4); }
.badge { display: inline-block; padding: 6px 12px; border-radius: 999px; font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; }
h1 { margin: 16px 0 8px; font-size: 30px; }
.host { font-weight: 700; color: #f8fafc; word-break: break-all; }
p { color: #cbd5e1; line-height: 1.6; margin: 8px 0; }
.actions { display: flex; gap: 12px; margin-top: 24px; }
button { font: inherit; font-size: 14px; padding: 10px 16px; border-radius: 12px; border: 0; cursor: pointer; background: linear-gradient(135deg, #3b82f6, #22c55e); color: #08111f; font-weight: 700; }
button.secondary { background: rgba(148, 163, 184, 0.16); color: #e5eefc; }
.search { margin-top: 24px; padding-top: 20px; border-top: 1px solid rgba(148, 163, 184, 0.18); }
.search label { display: block; font-size: 14px; color: #cbd5e1; margin-bottom: 10px; }
.search-row { display: flex; gap: 10px; }
.search input { flex: 1; min-width: 0; font: inherit; font-size: 14px; padding: 10px 14px; border-radius: 12px; border: 1px solid rgba(148, 163, 184, 0.3); background: rgba(2, 6, 23, 0.5); color: #f8fafc; }
.search input:focus { outline: 2px solid #3b82f6; outline-offset: 1px; }`;

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
<div class="search-row"><input id="study-search" name="${escapeHtml(search.param)}" type="search" placeholder="e.g. linear algebra lecture" autocomplete="off" required autofocus /><button type="submit">Search</button></div>
</form>`;
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
  return `<p>StudyNest judged this page as <strong>${escapeHtml(prediction.category)}</strong> (${Math.round(prediction.confidence * 100)}% confidence).</p>`;
}

export function buildInterstitialHtml({ blocked, sessionEndsAt }: InterstitialOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Blocked - StudyNest</title>
<style>
${BASE_STYLE}
body { background: radial-gradient(circle at top, rgba(239, 68, 68, 0.16), transparent 40%), linear-gradient(180deg, #0b1020, #0f172a); }
.badge { background: rgba(239, 68, 68, 0.18); color: #fca5a5; }
</style>
</head>
<body>
<main>
<span class="badge">StudyNest Study Mode</span>
<h1>Blocked during Study Mode</h1>
<p class="host">${escapeHtml(blocked.host)}</p>
<p>${escapeHtml(describePolicyReason(blocked.reason))}</p>
${describeClassification(blocked)}
<p>${formatEndTime(sessionEndsAt)}</p>
${renderSearch(blocked.host)}
<div class="actions"><button type="button"${searchFor(blocked.host) ? ' class="secondary"' : ''} onclick="history.length > 1 ? history.back() : null">Go back</button></div>
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
<style>
${BASE_STYLE}
main { text-align: center; }
.badge { background: rgba(59, 130, 246, 0.18); color: #93c5fd; }
.spinner { width: 34px; height: 34px; margin: 22px auto 6px; border-radius: 50%; border: 3px solid rgba(96, 165, 250, 0.2); border-top-color: #60a5fa; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<main>
<span class="badge">StudyNest Study Mode</span>
<div class="spinner" aria-hidden="true"></div>
<h1>Checking this page…</h1>
<p class="host">${escapeHtml(host)}</p>
<p>Making sure it's study material before it opens.</p>
</main>
</body>
</html>`;
}

export function buildCheckingUrl(url: string, host: string): string {
  return wrapInterstitialHtml(buildCheckingHtml(host), url, 'checking');
}
