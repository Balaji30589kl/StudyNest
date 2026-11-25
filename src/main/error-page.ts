import { PAGE_ICONS, PAGE_STYLE } from './page-style.js';
import { wrapInterstitialHtml } from './navigation-guard.js';

/** Chromium net error codes the shell does not treat as page failures. */
const IGNORED_ERRORS = new Set([
  -3, // ERR_ABORTED: user navigated away, or a redirect replaced the request
  -20, // ERR_BLOCKED_BY_CLIENT: cancelled by the navigation guard (Study Mode)
  -27 // ERR_BLOCKED_BY_RESPONSE: handled by the page/site itself
]);

export type LoadFailureKind = 'certificate' | 'offline' | 'dns' | 'refused' | 'timeout' | 'generic';

export function shouldShowErrorPage(errorCode: number, isMainFrame: boolean): boolean {
  return isMainFrame && errorCode < 0 && !IGNORED_ERRORS.has(errorCode);
}

export function classifyLoadFailure(errorCode: number): LoadFailureKind {
  if (errorCode <= -200 && errorCode > -300) return 'certificate';
  switch (errorCode) {
    case -106: // INTERNET_DISCONNECTED
      return 'offline';
    case -105: // NAME_NOT_RESOLVED
    case -137: // NAME_RESOLUTION_FAILED
      return 'dns';
    case -102: // CONNECTION_REFUSED
    case -100: // CONNECTION_CLOSED
    case -101: // CONNECTION_RESET
      return 'refused';
    case -7: // TIMED_OUT
    case -118: // CONNECTION_TIMED_OUT
      return 'timeout';
    default:
      return 'generic';
  }
}

const COPY: Record<LoadFailureKind, { title: string; heading: string; body: string }> = {
  certificate: {
    title: 'Connection not private',
    heading: "Your connection isn't private",
    body: "This site's security certificate isn't trusted, so someone could be intercepting the connection. StudyNest won't open it."
  },
  offline: { title: 'No internet', heading: "You're offline", body: 'Check your network connection, then try again.' },
  dns: { title: "Can't find site", heading: "This site can't be found", body: 'Check the address for typos, or try again in a moment.' },
  refused: { title: "Can't reach site", heading: "This site can't be reached", body: 'The site refused the connection or closed it unexpectedly.' },
  timeout: { title: 'Site took too long', heading: 'This site took too long to respond', body: 'The site may be busy or down. Try again in a moment.' },
  generic: { title: "Can't open page", heading: "This page couldn't be loaded", body: 'Something went wrong while loading the page.' }
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function buildErrorPageHtml(targetUrl: string, errorCode: number, errorDescription: string): string {
  const kind = classifyLoadFailure(errorCode);
  const copy = COPY[kind];
  const isWeb = /^https?:\/\//i.test(targetUrl);
  // Certificate failures get no retry shortcut: retrying cannot make the connection safe.
  const retry = kind !== 'certificate' && isWeb ? `<a class="button primary" href="${escapeHtml(targetUrl)}">Try again</a>` : '';

  const icon = kind === 'certificate' ? `<div class="icon danger" aria-hidden="true">${PAGE_ICONS.alert}</div>` : kind === 'offline' ? `<div class="icon warn" aria-hidden="true">${PAGE_ICONS.offline}</div>` : `<div class="icon warn" aria-hidden="true">${PAGE_ICONS.alert}</div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(copy.title)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<main>
${icon}
<h1>${escapeHtml(copy.heading)}</h1>
<p class="host">${escapeHtml(hostOf(targetUrl))}</p>
<p>${escapeHtml(copy.body)}</p>
<p><code>${escapeHtml(errorDescription || 'ERR_FAILED')} (${errorCode})</code></p>
<div class="actions">${retry}<button type="button" onclick="history.length > 1 ? history.back() : null">Go back</button></div>
</main>
</body>
</html>`;
}

export function buildErrorPageUrl(targetUrl: string, errorCode: number, errorDescription: string): string {
  return wrapInterstitialHtml(buildErrorPageHtml(targetUrl, errorCode, errorDescription), targetUrl, 'error');
}
