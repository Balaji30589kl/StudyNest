const LANDING_PAGE_HTML = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>StudyNest New Tab</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      html, body {
        width: 100%;
        height: 100%;
        margin: 0;
      }
      body {
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top, rgba(96, 165, 250, 0.18), transparent 32%),
          linear-gradient(180deg, #0b1020 0%, #0f172a 100%);
        color: #e5eefc;
      }
      .card {
        width: min(820px, calc(100vw - 48px));
        border: 1px solid rgba(148, 163, 184, 0.18);
        border-radius: 28px;
        background: rgba(15, 23, 42, 0.72);
        box-shadow: 0 30px 80px rgba(2, 6, 23, 0.35);
        padding: 36px;
        backdrop-filter: blur(18px);
      }
      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 8px 14px;
        border-radius: 999px;
        background: rgba(59, 130, 246, 0.16);
        color: #bfdbfe;
        font-size: 13px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      h1 {
        margin: 18px 0 12px;
        font-size: clamp(34px, 5vw, 56px);
        line-height: 1.05;
      }
      p {
        margin: 0;
        max-width: 56ch;
        color: #cbd5e1;
        font-size: 16px;
        line-height: 1.7;
      }
      .tiles {
        margin-top: 28px;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 14px;
      }
      .tile {
        border-radius: 20px;
        padding: 18px;
        min-height: 120px;
        background: rgba(15, 23, 42, 0.66);
        border: 1px solid rgba(148, 163, 184, 0.16);
      }
      .tile strong {
        display: block;
        margin-bottom: 8px;
        font-size: 14px;
      }
      .tile span {
        color: #94a3b8;
        font-size: 13px;
        line-height: 1.6;
      }
      .hint {
        margin-top: 24px;
        color: #f8fafc;
        font-size: 14px;
        opacity: 0.75;
      }
      @media (max-width: 720px) {
        .card { padding: 24px; }
        .tiles { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main class="card">
      <div class="eyebrow">StudyNest</div>
      <h1>Start a focused browsing session.</h1>
      <p>Search from the omnibox, open recent tabs, or jump directly into learning resources. This landing page keeps the browser clean and intentional.</p>
      <section class="tiles" aria-label="Quick actions">
        <div class="tile"><strong>Search</strong><span>Type a topic like “youtube dsa” or “machine learning tutorial” in the address bar.</span></div>
        <div class="tile"><strong>Open directly</strong><span>Enter a site such as leetcode.com, github.com, or docs you already know.</span></div>
        <div class="tile"><strong>Resume tabs</strong><span>Use the tabs row to switch back to active pages without losing context.</span></div>
      </section>
      <div class="hint">Tip: start typing to see suggestions below the search bar.</div>
    </main>
  </body>
</html>
`;

export const LANDING_PAGE_URL = `data:text/html;charset=UTF-8,${encodeURIComponent(LANDING_PAGE_HTML)}`;

export function isStudyNestLandingPageUrl(input: string): boolean {
  return input === LANDING_PAGE_URL;
}