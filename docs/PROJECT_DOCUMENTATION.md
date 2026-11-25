# StudyNest: Project Documentation

StudyNest is a desktop web browser for students. It works like any everyday browser until you switch on **Study Mode**. Then it checks every page before it appears, blocks the distracting ones, keeps study material open, and records a focus session.

This document explains the whole project for someone new to it: the problem, the approach, the architecture, the decisions and the reasons behind them, the problems we ran into, and how to run and extend it. The per-phase guides in `docs/` hold deeper detail. This document links them together.

---

## Contents

1. [The problem](#1-the-problem)
2. [Goals and non-goals](#2-goals-and-non-goals)
3. [The solution at a glance](#3-the-solution-at-a-glance)
4. [Key decisions and why](#4-key-decisions-and-why)
5. [Architecture](#5-architecture)
6. [How a page is judged (the classification pipeline)](#6-how-a-page-is-judged-the-classification-pipeline)
7. [Study Mode and focus view](#7-study-mode-and-focus-view)
8. [The everyday browser](#8-the-everyday-browser)
9. [Data and privacy](#9-data-and-privacy)
10. [How the project was built (phases)](#10-how-the-project-was-built-phases)
11. [Challenges and how they were solved](#11-challenges-and-how-they-were-solved)
12. [Running, configuring and extending](#12-running-configuring-and-extending)
13. [Testing](#13-testing)
14. [Status, limitations and what's next](#14-status-limitations-and-whats-next)
15. [Glossary](#15-glossary)

---

## 1. The problem

Students study in the same browser where their distractions live. A lecture on YouTube sits next to a comedy clip, a Shorts shelf and a music video. A documentation page carries shopping ads. One click, or even a hover, pulls attention away.

The usual tools don't fit:

- **Willpower** fails exactly when attention is low.
- **Site blockers** are blunt. They block whole sites, but YouTube is also where the lectures are. Blocking YouTube blocks the lesson; allowing it allows everything.
- **Browser extensions** can be switched off in two clicks, often run after the page has already appeared, and only see what one browser shows them.

**Problem statement:** give students one browser that is pleasant for everyday use. When they start a focused study session, it should stop distracting content, both pages and the distracting parts inside pages, while keeping the study material they need fully available. It must judge the specific page or video, not just the website.

## 2. Goals and non-goals

**Goals**

- A real everyday browser: tabs, a good address bar, bookmarks, history, downloads, find in page, session restore and a polished look, so students actually use it.
- **Study Mode:** an on/off focus session that is logged (focus time, what was blocked) and summarized in Insights.
- Judge **each page or video**, before it renders, and block distracting ones. Use fixed lists where the answer is obvious, and AI where it isn't.
- Remove distractions **inside** allowed pages: hover previews and ads.
- Keep working when the AI is slow or offline.
- Keep the AI provider key out of the app.

**Non-goals (for now)**

- Deployment to a server. The AI gateway runs on the student's laptop, on Gemini's free tier.
- Private windows, multiple windows, a password manager, extensions, bookmark folders.
- macOS and Linux builds (the code is portable; packaging and testing target Windows).
- Making Study Mode impossible to switch off. It's a focus aid, not parental control.

## 3. The solution at a glance

| When | What StudyNest does |
|---|---|
| Normal browsing | A full browser with its own design, light/dark themes, and an ad and tracker blocker |
| Study Mode on, opening a page | Block list → blocked. Allow list → opens. Anything else → a "Checking page…" screen while AI judges that exact page, then it opens or is blocked |
| Study Mode on, on YouTube | Each video and each search is judged separately: a lecture opens, comedy/music/gaming/sports are blocked, Shorts are always blocked |
| Study Mode on, inside an allowed page | Hover previews don't play, YouTube video ads are skipped, ads are blocked on every site |
| Throughout | Focus time, blocked pages and AI verdicts are logged and shown in the Study panel and Insights |

A blocked page shows a calm explanation. On YouTube it also offers a search box, so the student can look for a lecture directly.

## 4. Key decisions and why

These are the choices that shaped the project, with the reasoning and the alternatives considered.

| Decision | Why | Alternatives considered |
|---|---|---|
| **A full desktop browser, not an extension** | The browser controls every navigation before anything renders, can't be disabled with a toggle in another browser's menu, and can give Study Mode first-class UI | A Chrome extension: sees pages late, easy to switch off, limited UI |
| **Electron + React + TypeScript** | A real Chromium engine (sites work as in Chrome), web technologies for the UI, one language everywhere, strong typing for the many process boundaries | Native (C++/CEF): much slower to build |
| **Check pages *before* they render** | A student should never see a distracting page, even for a second. Navigations are intercepted in the network layer and replaced with "Checking page…" until a verdict exists | Classify after load and block on the next visit (the Phase 3 design, replaced in Phase 6) |
| **Lists first, AI second** | Obvious cases (instagram.com, wikipedia.org) need no AI: instant, free, predictable. AI handles the long tail. Lists always win over AI | AI for everything: slower, costs quota, less predictable |
| **AI only predicts; fixed rules decide** | The AI returns a category and confidence. A small pure function (`study-policy.ts`) turns that into allow/block. Behavior stays testable, explainable and tunable without touching the AI | Let the AI answer "block or allow": opaque and hard to tune |
| **Judge per video on video sites** | YouTube is both the best and worst site for students. Per-video judgment (and per-search) is what makes it usable during study | Per-site judgment: YouTube all-or-nothing |
| **A separate AI gateway holds the key** | A key shipped inside a desktop app can be extracted. The gateway keeps it, rate-limits, caps daily use, caches per page and serves the lists | Key in the app (the Phase 3 design, replaced in Phase 6) |
| **Gemini on the free tier, Claude supported** | The student's choice: free for development. The gateway supports both behind one interface; switching is one setting | Claude only |
| **Offline rules as a fallback, failing closed on video sites** | The AI can be slow or unreachable. Keyword rules keep Study Mode working; on video sites an *unidentified* video stays blocked rather than slipping through | Fail open (allow when unsure): lets distractions through when the AI is down |
| **Rules are backend files, not user settings** | Lists, classification settings and focus rules live in `policy/*.json`, served by the gateway. Study Mode can't be weakened from inside the app, and rules can be updated without shipping a new app | User-editable lists (removed in Phase 6) |
| **Focus view hides only what needs no click** | Hover previews and ads reach the student without a decision. Recommendations stay visible because "Up next" is often the next lecture, and anything opened from them is checked anyway | Hiding sidebars and comments (an early draft, narrowed after review) |
| **Built-in pages drawn by the browser** | `studynest://newtab`, `history`, `bookmarks` and `settings` are drawn by the chrome, so they can use browser data without exposing it to websites | Web pages with a privileged bridge |
| **Native OS menus** | Right-click and the ⋯ menu are drawn by Windows above the page, follow the system theme and need no overlay tricks | HTML menus (would be hidden under the page view) |

## 5. Architecture

### 5.1 Processes

```
┌──────────────────────────── StudyNest desktop app (Electron) ─────────────────────────────┐
│                                                                                           │
│  Main process (Node)                         Browser chrome (renderer, React)             │
│  • TabManager: tabs, navigation, the one     • Tab strip, toolbar, address bar            │
│    network request listener                  • Built-in pages (new tab, history,          │
│  • Study Mode service + policy               •   bookmarks, settings)                     │
│  • Classification client (AI)                • Study, Insights, Downloads panels          │
│  • Focus view, ad blocker                    • Talks to main only through a typed,        │
│  • History, bookmarks, settings, session     •   sender-checked IPC bridge (preload)      │
│  • Downloads, permissions, updates, logs                                                  │
│                                                                                           │
│  Tabs: one sandboxed web view per tab (real websites), positioned under the chrome        │
└───────────────────────────────────────────────┬───────────────────────────────────────────┘
                                                │ HTTP (localhost:8787)
                               ┌────────────────▼─────────────────┐
                               │ AI gateway (Node, gateway/)      │──► Gemini (or Claude)
                               │ holds the key, rate limit, daily │
                               │ cap, cache, serves policy/*.json │
                               └──────────────────────────────────┘
```

**Security model.** Websites run in sandboxed tabs with no access to the app. The chrome is sandboxed too, has a strict Content-Security-Policy, can't navigate away, and talks to main only through `handleTrusted` IPC handlers that reject any other sender. Site permissions (camera, microphone, location…) are asked for, and device access is always denied.

### 5.2 Folder map

```
src/
  main/                  Electron main process
    index.ts             app start-up and wiring
    tab-manager.ts       tabs, navigation, request filtering, built-in pages
    navigation-guard.ts  interface the shell uses to ask "may this page load?"
    browser/             history, bookmarks, settings, session restore, ad blocker, menus
    study/               Study Mode service, block/checking pages, focus view, YouTube helper
    ai/                  classification client, page metadata, gateway + offline providers
    policy/              loads policy files (bundled → gateway → cache)
    security/ downloads/ update/ account/ sync/ observability/ storage/
  preload/               the typed bridge between chrome and main
  renderer/src/          the browser chrome UI (React): components/, pages/, panels
  shared/                pure code used by main, renderer and gateway
    study-policy.ts      the allow/block decision (pure function)
    classification.ts    categories, prompt, JSON schema, validation
    focus-rules.ts       focus view rules (validation, stylesheet)
    url.ts, internal-pages.ts, search-engines.ts, browser-settings.ts, insights.ts
gateway/src/             the AI gateway server (Gemini and Claude classifiers)
policy/                  blocklist.json, allowlist.json, classification.json, focus.json
config/app.json          gateway address, policy refresh interval
e2e/                     end-to-end test harness and suites
docs/                    this document and the per-phase guides
```

### 5.3 Design rules the code follows

- The browser shell (`TabManager`) knows nothing about Study Mode or AI. Study Mode plugs in through a `NavigationGuard` and listener hooks.
- Decisions live in **pure functions** (`study-policy.ts`, `focus-rules.ts`, `shortcuts.ts`, `menus.ts`…), so they're unit tested without Electron.
- The renderer displays state and sends intents. It never decides policy.
- Electron allows only **one** network request listener per session, so the tab manager owns it and the ad blocker and Study Mode run inside it.
- Every input crossing a boundary (IPC payloads, policy files, AI answers, page metadata) is validated.

## 6. How a page is judged (the classification pipeline)

```
You open a page, click a video, or search on YouTube
        │
        ▼
1. TAB MANAGER intercepts the navigation before anything renders
   (also catches YouTube's in-page video switches)
        │
        ▼
2. STUDY POLICY decides (pure rules, no AI)                      src/shared/study-policy.ts
   Study Mode off            → allow
   on the block list         → BLOCK
   on the allow list         → allow     (most specific rule wins; block wins ties)
   already judged (cache)    → use that verdict
   otherwise                 → "check": the tab shows "Checking page…"
        │
        ▼
3. CLASSIFICATION CLIENT gathers facts about the page            src/main/ai/
   • Cache key: per site, or per video/search on YouTube, Vimeo and similar sites
   • A YouTube search is described by its query
   • Pages: title, description, keywords, headings, short text sample
     (+ YouTube's oEmbed for the video title and channel)
        │
        ▼
4. AI GATEWAY (localhost:8787)                                    gateway/src/
   • Sends the facts and the study prompt to Gemini; races up to three models
     (the next starts after 2.5 s or on an error), first valid answer wins
   • Answer: { category, confidence, rationale }
       study · reference · productivity · news · social ·
       entertainment · shopping · gaming · sports · other
   • Gateway down or slow (> 10 s) → offline keyword rules answer instead
        │
        ▼
5. VERDICT is cached (7 days; offline guesses 15 s to 2 min) and the policy decides:
   social / entertainment / shopping / gaming / sports with ≥ 60% confidence → BLOCK
   unidentified video ("other", low confidence)                               → BLOCK
   anything else (study, reference, news…)                                    → ALLOW
        │
        ▼
6. The page opens, or the block page appears; the result is logged in Study stats and Insights
```

**Why categories?** The AI's judgment is real: it reads that specific page and reasons about it. The category is only the *format* of its answer. That keeps the allow/block step fixed and tunable from `policy/classification.json` (which categories block, the confidence threshold) without code changes.

**Prompt safety.** Page text is untrusted. The prompt tells the model to treat it as data, the answer is forced into a JSON schema, and it is validated again. The category must come from the fixed list, and confidence is clamped. The worst a malicious page can achieve is a wrong verdict for itself.

## 7. Study Mode and focus view

**Study Mode** is a switch in the toolbar (with optional timed sessions on the new tab page and in the Study panel). While it's on:

- Every navigation goes through the pipeline above. Pages already open are re-checked when it's switched on.
- Focus and away time, pages visited, pages blocked (by list or by AI) and AI verdicts are recorded. The Study panel shows the live session; **Insights** shows streaks, a 14-day chart, top sites and a category breakdown.
- A warning dot appears on the Study chip if AI checks are offline.

**Focus view** (Phase 8) removes distractions inside allowed pages, following one principle: *hide only what reaches you without a click.*

- **Hover previews off:** YouTube's hover player and the animated thumbnails of "Up next" cards (put back to the still image; the clip is never downloaded).
- **YouTube video ads skipped:** fast-forwarded, muted, to their end, then the lecture's volume and speed are restored.
- **Ad overlays and ad slots hidden**, and the **ad blocker forced on** for every site during a session.
- Recommendations, "Up next" and comments **stay visible**: anything opened from them is checked first.

Rules live in `policy/focus.json`: CSS selectors to hide (validated so a policy file can only hide elements) and request prefixes to refuse. Technically, the stylesheet is inserted once per page and scoped to `html[data-studynest-focus]`, and Study Mode only toggles that attribute (see challenge 18).

## 8. The everyday browser

- **Look:** an original "Paper & Moss" design. Warm neutral surfaces, one moss-green accent, hairline borders, the native Segoe UI Variable font, light/dark/system themes. The chrome is about 80 px tall (tabs and toolbar) plus an optional bookmarks bar.
- **Tabs:** site icons, loading spinners, audio indicator and mute, pin, drag to reorder, middle-click to close, right-click menu, reopen closed tabs, restore after restart.
- **Address bar:** the domain is emphasized when idle; inline autocomplete from history; grouped suggestions (open tabs, bookmarks, history, search suggestions); a security indicator; zoom chip; ad-blocker shield with a count; bookmark star.
- **Built-in pages:** new tab (search, most visited, start a focus session), history (by day, searchable), bookmarks (rename, reorder, delete with undo), settings (theme, search engine, startup, privacy and ad blocking, clear data, site permissions, default browser, account and sync, updates, shortcuts).
- **Also:** find in page, print, right-click menus in pages (open link in new tab, save image, search selection, spelling suggestions, inspect), downloads panel, five search engines, keyboard shortcuts matching other Windows browsers, error pages, permission prompts, auto-update (installed builds), single window (opening StudyNest again opens a tab).

## 9. Data and privacy

| Data | Where | Leaves the device? |
|---|---|---|
| History, bookmarks, settings, open tabs | `%APPDATA%\studynest\*.json` | No |
| Study sessions and events | `study-data.json` | Only session summaries, if folder sync is enabled |
| AI verdicts cache | `ai-data.json` | No |
| Page facts for an AI check (title, description, headings, short text sample, URL) | Sent to the gateway on your laptop, which sends them to Gemini | Yes, to the LLM provider, for unlisted pages during Study Mode only |
| AI provider key | `gateway/.env` (never committed) | Only to the provider |
| Search suggestions (what you type in the address bar) | Sent to DuckDuckGo | Yes; can be turned off in Settings |

No cookies, form values or full page HTML are ever sent for classification. Logs record hosts and counts, never full URLs or page content. On Gemini's free tier, Google may use requests to improve its products.

## 10. How the project was built (phases)

| Phase | What it delivered | Notable changes later |
|---|---|---|
| **1 Browser shell** | Electron window, React chrome, tabs, navigation | Chrome redesigned in Phase 7 |
| **1.1 Omnibox** | Search vs. address detection, DuckDuckGo suggestions | Grouped suggestions and inline autocomplete in Phase 7 |
| **2 Study Mode (no AI)** | Timed sessions, block/allow lists, block page before render, focus tracking | Warn mode, overrides and user-edited lists removed in Phase 6 |
| **3 AI classification** | Provider abstraction (offline rules, local model, Claude), cache, fallback | Classified *after* load and per site; key in the app; all replaced in Phase 6 |
| **4 Productization** | Insights dashboard, local profile and folder sync, logs, crash recovery | Settings drawer became a page in Phase 7 |
| **5 Release and hardening** | Shortcuts, downloads, permissions, CSP and sandboxing, error pages, Windows installer, auto-update, CI and e2e tests | |
| **6 Pre-render AI and gateway** | Checks *before* rendering, per-video judging, backend policy files, the gateway holds the key, on/off Study Mode | Gemini support, sports category, faster and more reliable AI added during Phase 7 |
| **7 Daily browser** | New design and every everyday feature (section 8), ad blocker, built-in pages | |
| **8 Focus view** | Hover previews off, YouTube ads skipped, ads forced off during sessions | Narrowed to "only what needs no click" after review |

Per-phase guides: `docs/implementation-guide.md`, `docs/phase-*.md`. Version history: `CHANGELOG.md`.

## 11. Challenges and how they were solved

Each entry gives what went wrong, why, and the fix. Most were found by testing in the real app against real sites, not just in unit tests.

### AI and classification

1. **YouTube videos were judged from an empty page.** YouTube answers background page requests with a 429 "unusual traffic" CAPTCHA page, and the code read that page as the video. Every video was judged by its URL alone, and the offline rules blocked even lectures.
   *Fix:* treat error responses, bot checks and consent walls as refused, and get YouTube/Vimeo titles and channels from their official **oEmbed** endpoint.

2. **No way to use Gemini.** The gateway supported Claude only, and the student had a Gemini key.
   *Fix:* a Gemini classifier behind the same interface, sharing the prompt and JSON schema; `LLM_PROVIDER` selects it.

3. **The YouTube homepage was blocked with no way forward.** The AI rightly judged the feed as entertainment.
   *Fix:* the block page on YouTube offers a search box, so the student can go straight to results.

4. **Any YouTube search opened, including "funny comedy videos".** Search results were on the allow list.
   *Fix:* searches are checked, judged by their query (the results page isn't fetched), with prompt guidance for search pages.

5. **YouTube pages were checked twice, with a reload.** YouTube adds `themeRefresh=1` to the address after loading, which looked like a new page.
   *Fix:* that parameter is ignored when identifying a page.

6. **Cricket highlights opened during Study Mode.** There was no sports category, and when the gateway was down the offline rules called them "other" and allowed them.
   *Fix:* a **sports** category (AI and offline rules), and **unidentified videos stay blocked** (`blockUnclearPerPage`).

7. **The AI "wasn't working well".** Gemini's free tier sometimes takes 5 to 30 s, and the app gave up after 6 s and kept the weak offline guess for 30 minutes. Bursts also hit the free tier's per-minute rate limit (HTTP 429).
   *Fix:* the gateway **races models** (next one after 2.5 s or on an error); the app waits 10 s (longer than the gateway's 9 s budget); offline guesses expire in 15 s to 2 min; the offline rules learned common study terms. Measured: failures went from 3 in 20 to 1 in 20, with an average of 2.2 s.

8. **The backup Gemini model stalled.** Measurements showed `gemini-3.1-flash-lite` often hangs while `3.5-flash-lite` is reliable.
   *Fix:* `3.5-flash-lite` became the first backup.

### Ad blocking

9. **The ad blocker would have switched off Study Mode.** Its standard setup installs its own network listener, and Electron allows only one, so it would silently replace Study Mode's.
   *Fix:* the filter engine runs **inside** the tab manager's listener.

10. **The ad blocker needed an Electron API that doesn't exist in Electron 31** (`registerPreloadScript`).
    *Fix:* its page script is installed with the older `session.setPreloads`.

11. **YouTube videos stayed black with the ad blocker on.** The filter lists' injected scripts broke YouTube's player, and their stand-in `data:` redirects **crash Electron 31's main process**. The app shut down seconds after loading a video page in tests.
    *Fix:* ads are blocked by request and hidden with CSS only; no scripts are injected, and redirects become plain blocks. Found by testing each part of the ad blocker on its own.

### Browser

12. **Automated tests couldn't launch the redesigned app.** Built-in pages left the tab's web view without any document, and Playwright waits forever on a page with no renderer.
    *Fix:* every tab always holds a document (`about:blank` placeholder), and its own navigation events are ignored.

13. **Back went to a blank page** after searching from the new tab page.
    *Fix:* Back from a tab's first page returns to the built-in page it came from, and Forward returns without reloading.

14. **Find in page counted wrong.** Electron's `findNext` flag means "start a new search", the opposite of what its name suggests.
    *Fix:* the flag is inverted, and results from superseded searches are ignored.

15. **Restored tabs came back blank.** The placeholder document's navigation overwrote the saved address.
    *Fix:* placeholder events are ignored.

16. **Tabs were too narrow** ("New tab" was cut off) because of how the scrolling tab row sized itself.
    *Fix:* tabs have a preferred width and shrink only when space runs out.

17. **The gateway's setup template was missing from git.** The `.env.*` ignore rule also matched `.env.example`.
    *Fix:* an explicit exception in `.gitignore`.

### Focus view

18. **Pages stayed in focus view after Study Mode ended.** In Electron 31, `removeInsertedCSS` silently does nothing after a page reload. Found by logging every insert and remove, then proven with a direct API test.
    *Fix:* never remove CSS. Insert it once per page, scoped to an attribute, and toggle the attribute. This also sidesteps sites' Content-Security-Policy.

19. **Two stylesheets could be inserted at once** when a reload and a Study Mode change happened together.
    *Fix:* updates for one page run one after another.

20. **Skipping YouTube ads.** YouTube ignores scripted clicks on its Skip button, and jumping an ad to its exact end froze the player for about 10 s.
    *Fix:* jump to just before the end at 16× speed (muted) and let the ad finish itself; the lecture's volume and speed are restored.

21. **Hover previews still played in the "Up next" sidebar.** Those cards don't use a video player; they swap the thumbnail for an **animated WebP image**. Found from a user screenshot and YouTube's `animatedThumbnail` page data.
    *Fix:* the still image is put back, the clip's download is refused (`i.ytimg.com/an_webp/`), and CSS hides any that slip through.

### Process

22. **Leftover test apps and locked folders.** A failed test run could leave an app running that held its profile folder, so later runs exited immediately and looked like launch failures.
    *Fix:* fresh profile names, and `STUDYNEST_E2E_OUTPUT` to move test output when the folder is locked.

## 12. Running, configuring and extending

### Prerequisites

Windows 10/11, Node.js 20 or newer, and a Gemini API key (free from Google AI Studio) or an Anthropic key.

### First run

```bash
npm install
# Create gateway/.env from gateway/.env.example and set:
#   LLM_PROVIDER=gemini
#   GEMINI_API_KEY=<your key>
npm run build
npm run dev        # starts the AI gateway (when a key is set) and the app
```

In VS Code's terminal, Electron needs `ELECTRON_RUN_AS_NODE` unset. `npm run dev` handles this for you.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Gateway (if `gateway/.env` has a key) + app in development mode |
| `npm run dev:app` | App only |
| `npm run build` | Production bundles |
| `npm run verify` | Type checks, unit tests, app and gateway builds |
| `npm run test:e2e` | End-to-end checks against the built app |
| `npm run dist:win` | Windows installer and portable app in `release/` |
| `npm run gateway:start` | The gateway on its own |

### Changing what Study Mode does (no code changes)

| To change | Edit | Example |
|---|---|---|
| Sites always blocked | `policy/blocklist.json` | `"snapchat.com"`, `"youtube.com/shorts"` |
| Sites always allowed | `policy/allowlist.json` | `"docs.google.com"`, `"reddit.com/r/learnprogramming"` |
| Which categories block, confidence threshold, per-page sites, blocking unidentified videos | `policy/classification.json` | add `"news"` to `distractingCategories` |
| What focus view hides or refuses | `policy/focus.json` | add `"ytd-comments"` to hide YouTube comments |

Rules: a domain covers its subdomains, a path narrows it, the most specific rule wins, and block wins ties. The gateway re-reads these files within a minute, and the app picks them up when it starts (then every 6 hours).

### Gateway settings (`gateway/.env`)

`LLM_PROVIDER` (`gemini` or `claude`), `GEMINI_API_KEY`, `GEMINI_MODEL` (default `gemini-flash-lite-latest`), `GEMINI_FALLBACK_MODELS` (default `gemini-3.5-flash-lite,gemini-3.1-flash-lite`), `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` (default `claude-haiku-5-5`), `RATE_LIMIT_PER_MINUTE` (30), `DAILY_REQUEST_CAP` (5000), `CLIENT_TOKEN` (optional).

### Extending

- **A new AI provider:** implement the `Classifier` function type in `gateway/src/` (see `gemini-classifier.ts`) and select it in `gateway/src/main.ts`. The app needs no change.
- **A new category:** add it to `PAGE_CATEGORIES` and the prompt in `src/shared/classification.ts`, and optionally to the offline lexicon in `rule-based-provider.ts`.
- **New request filtering:** go through `TabManager`'s single request listener (`setSubresourceFilter`), never a second `onBeforeRequest`.
- **New browser data:** follow the pattern of `history-service.ts` (a service with an injected store, pure logic, unit tests) and expose it through typed IPC in `src/shared/ipc.ts` and `src/preload/index.ts`.

## 13. Testing

- **Unit tests (158, Vitest):** the policy decision, classification parsing and prompt, URL handling, history ranking, bookmarks, session restore, settings validation, menus, shortcuts, address-bar suggestions, focus rules and focus view, the ad-blocker filter, the gateway (limits, cache, both classifiers, model racing).
- **End-to-end (107 checks, Playwright driving the built app):** suites for Study Mode, AI (through the real gateway with the LLM stubbed), product (Insights, sync, crash recovery), browser basics, security (sandboxing, permissions, IPC), UI, and everyday browsing (new tab page, Back/Forward, history, bookmarks, find, built-in pages, themes, search engines, pinning, focus view, session restore). The ad blocker is off in tests (`STUDYNEST_ADBLOCK=off`) so no lists are downloaded.
- **Live checks:** features that depend on real sites (YouTube judging, ad skipping, animated thumbnails, Gemini latency) were verified in the running app against real YouTube and the real Gemini API during development.

Run before every merge: `npm run verify` and `npm run test:e2e`. One check (the Insights chart tooltip) is occasionally flaky on timing and passes on rerun.

## 14. Status, limitations and what's next

**Status:** the core promise works end to end. StudyNest is a complete everyday browser, and Study Mode blocks distracting pages and videos with AI before they render, keeps study content open, and removes hover previews and ads inside pages.

**Known limitations**

- The AI gateway runs on the student's laptop on Gemini's free tier, so checks can be slow at busy times. Unclear videos are then blocked until the AI answers (Reload retries).
- Ads a creator speaks *inside* a video (sponsor segments) can't be detected.
- Focus view rules target YouTube; YouTube layout changes may need `policy/focus.json` updates.
- Sites outside the per-page list get one verdict per site.
- Study Mode can be switched off with one click.
- Windows only; builds are unsigned (SmartScreen warns on first install).
- No private or multiple windows, password manager, extensions or bookmark folders.

**Possible next steps (when the student decides)**

- Deploy the gateway (Render/Railway) and consider a paid tier for reliability.
- Harder-to-quit sessions (a lock for N minutes, or a reason to stop early).
- Grow the block and allow lists.
- Publish a release (merge to `main`, tag a version; the installer and auto-update are ready).

## 15. Glossary

| Term | Meaning |
|---|---|
| **Study Mode** | The focus session: pages are checked and distractions removed while it's on |
| **Focus view** | The in-page part of Study Mode: hover previews off, ads skipped or blocked |
| **Gateway** | The small local server that holds the AI key and talks to Gemini or Claude |
| **Policy files** | `policy/*.json`: the block/allow lists, classification settings and focus rules |
| **Verdict / classification** | The AI's answer for a page: category, confidence and a one-line reason |
| **Per-page hosts** | Sites judged page by page (YouTube, Vimeo, Dailymotion, Medium, Quora) instead of once per site |
| **Block page / interstitial** | The page shown in place of a blocked page |
| **Checking page** | Shown while a page is being judged, before it may render |
| **Built-in pages** | `studynest://newtab`, `history`, `bookmarks`, `settings`, drawn by the browser itself |
| **Chrome** | The browser's own UI around web pages (tabs, toolbar), not Google Chrome |
| **oEmbed** | YouTube's official endpoint that returns a video's title and channel |
