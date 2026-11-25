/**
 * Shared look for pages the browser draws itself inside a tab: the Study Mode
 * block page, the "Checking page…" screen and error pages. Same palette as the
 * browser chrome, and light or dark with the browser theme.
 */
export const PAGE_STYLE = `
:root {
  --page: #f8f7f4; --card: #ffffff; --field: #ecE9e3; --border: rgba(34,32,28,.12); --border-strong: rgba(34,32,28,.2);
  --text: #22201c; --text-2: #5c574f; --text-3: #8a847a;
  --accent: #2f6b4f; --accent-hover: #285c44; --accent-text: #ffffff; --accent-soft: rgba(47,107,79,.11); --accent-ink: #24563f;
  --danger: #b4402e; --danger-soft: rgba(180,64,46,.1); --warn: #9a640f; --warn-soft: rgba(154,100,15,.12);
  color-scheme: light;
  font-family: 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
  font-size: 14px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --page: #1d1e20; --card: #26272a; --field: #1b1c1e; --border: rgba(255,255,255,.09); --border-strong: rgba(255,255,255,.16);
    --text: #ebe9e4; --text-2: #b3afa7; --text-3: #807c75;
    --accent: #7dc29c; --accent-hover: #93cfad; --accent-text: #10241a; --accent-soft: rgba(125,194,156,.14); --accent-ink: #9fd3b6;
    --danger: #f08a78; --danger-soft: rgba(240,138,120,.12); --warn: #e4b45e; --warn-soft: rgba(228,180,94,.13);
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; background: var(--page); color: var(--text); }
main { width: min(560px, calc(100vw - 48px)); margin: 16vh auto 48px; }
.icon { width: 48px; height: 48px; display: grid; place-items: center; border-radius: 50%; margin-bottom: 20px; background: var(--accent-soft); color: var(--accent-ink); }
.icon svg { width: 24px; height: 24px; }
.icon.danger { background: var(--danger-soft); color: var(--danger); }
.icon.warn { background: var(--warn-soft); color: var(--warn); }
.eyebrow { margin: 0 0 6px; color: var(--text-3); font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
h1 { margin: 0 0 8px; font-family: 'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif; font-size: 26px; font-weight: 600; letter-spacing: -.01em; }
.host { margin: 0 0 16px; color: var(--text); font-weight: 600; word-break: break-all; }
p { margin: 8px 0; color: var(--text-2); line-height: 1.6; }
strong { color: var(--text); }
code { color: var(--text-3); font-family: 'Cascadia Mono', Consolas, monospace; font-size: 12px; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 24px; }
a.button, button { font: inherit; height: 36px; display: inline-flex; align-items: center; padding: 0 16px; border-radius: 8px; border: 1px solid var(--border-strong); background: var(--card); color: var(--text); text-decoration: none; font-weight: 500; cursor: default; }
a.button:hover, button:hover { background: var(--field); }
.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
.primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
.search { margin-top: 28px; padding-top: 24px; border-top: 1px solid var(--border); }
.search label { display: block; margin-bottom: 10px; color: var(--text-2); }
.search-row { display: flex; gap: 8px; }
.search input { flex: 1; min-width: 0; height: 40px; padding: 0 14px; border-radius: 20px; border: 1px solid var(--border-strong); background: var(--card); color: var(--text); font: inherit; outline: none; }
.search input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.search button { height: 40px; border-radius: 20px; }
.spinner { width: 28px; height: 28px; border-radius: 50%; border: 3px solid var(--accent-soft); border-top-color: var(--accent); animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2.4s; } }
`;

/** Small inline icons (Lucide shapes), so the pages need no external resources. */
export const PAGE_ICONS = {
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m4.5 4.5 15 15"/></svg>',
  offline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h.01"/><path d="M8.5 16.43a5 5 0 0 1 7 0"/><path d="M5 12.86a10 10 0 0 1 5.17-2.69"/><path d="M19 12.86a10 10 0 0 0-2-1.43"/><path d="M2 8.82a15 15 0 0 1 4.18-2.65"/><path d="M22 8.82a15 15 0 0 0-11.29-3.76"/><path d="m2 2 20 20"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>'
} as const;
