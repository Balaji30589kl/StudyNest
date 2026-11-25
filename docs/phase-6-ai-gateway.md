# Phase 6 Pre-Render AI Checks and Gateway Implementation Guide

## Goal
Match the intended product. Students get a normal browser plus a Study Mode they can switch on and off, or run on a timer. During Study Mode, **every page is decided before it renders**:

1. Block list → blocked.
2. Allow list → opens.
3. Anything else → its metadata is sent to an LLM through the StudyNest gateway, which returns a category; distracting categories are blocked.

Video sites are judged **per video**, so a lecture opens and a funny Short on the same site is blocked.

## What Changed

| Area | Before (0.3) | Now (0.4) |
|---|---|---|
| Lists | Edited by the user in the Study panel | Backend files `policy/blocklist.json` and `allowlist.json`, read-only in the app, refreshed from the gateway |
| Rules | Domains only | Domain plus optional path prefix (`youtube.com/shorts`, `youtube.com/results`) |
| AI timing | After the page loaded; blocked on the next visit | **Before rendering**, behind a "Checking page…" screen |
| AI granularity | Per site | Per page for `perPageHosts` (YouTube per video id); per site elsewhere |
| LLM access | In the app (user-supplied key, provider picker) | Only through the **gateway**; the app holds no key |
| Study Mode | Timed sessions only | On/off switch (open-ended) plus optional timers |
| Warn mode, overrides, tighten-only, strict mode | Present | Removed: decisions are final, and rules aren't user settings |
| Analytics | Focus, streaks, blocked total | Also blocked by list vs. AI, AI checks, category breakdown, most-blocked sites, daily blocked count |

## Architecture

```
renderer  Study switch · Study panel · Insights        (display + intents only)
   │ typed IPC
main
 ├─ TabManager             holds every top-level request; asks the guard
 │    allow → load · intercept → block page · defer → "Checking page…" → retry
 ├─ StudyModeService       on/off + timers, stats, history; the NavigationGuard
 │    └─ evaluateStudyPolicy (shared, pure): off → internal → list rule → cached verdict → "check"
 ├─ PolicyService          policy/*.json (bundled) → gateway /v1/policy → cached copy
 └─ ClassificationClient   per-page cache · fetchPageMetadata (HTML fetched in main, not rendered)
        → GatewayProvider ──HTTPS──► gateway ──► Claude (structured JSON)
        → RuleBasedProvider (offline fallback: keywords + platform genre)
gateway/ (separate Node service)
 ├─ POST /v1/classify   rate limit · daily cap · cache · in-flight de-dupe · sanitize
 ├─ GET  /v1/policy     serves policy/*.json
 └─ GET  /health
```

### Request flow for an unlisted page during Study Mode
1. `onBeforeRequest` catches the main-frame request. The guard answers **defer**, so the request is cancelled and the "Checking page…" screen loads.
2. Main fetches the URL's HTML (with the browser session's cookies) and parses `<title>`, `og:*`, `description`, YouTube's `itemprop="genre"`, keywords, h1/h2 headings and a text sample. Nothing renders.
3. The metadata goes to the gateway. The gateway checks its cache, then asks Claude with the page-level, injection-aware prompt (`CLASSIFIER_SYSTEM_PROMPT` in `shared/classification.ts`).
4. The verdict is cached under the page's key. The tab requests the URL again; the guard now answers synchronously: **allow** (it renders) or **intercept** (block page with the predicted category).
5. YouTube changes videos in-page with `pushState`. `did-navigate-in-page` runs the same check, so the next video is judged too.

### Failure behavior
- Gateway down, slow (6 s timeout) or rate-limited → offline keyword rules decide, including the platform genre. Those answers are cached for only 30 minutes, so the real classifier is retried soon.
- Site unreachable → offline rules decide from the URL, and the shell shows its normal error page.
- PDFs and other non-HTML files → allowed (documents aren't distractions to judge).
- A page that still answers "defer" right after a finished check is allowed rather than looping.

## Key Rules for Future Work
- Policy stays pure in `shared/study-policy.ts`. The LLM only predicts a category, and list rules always win over predictions.
- The app must never hold an LLM key. New classifiers belong in the gateway.
- Changing which categories block, the confidence threshold, or which hosts are judged per page is a `policy/classification.json` change, not a code change.

## Verification
- `npm run verify`: typecheck, 116 unit tests, app build, gateway build. New coverage: path rules, per-page keys (YouTube ids, tracking parameters dropped), the defer flow, de-duplicated checks, open-ended sessions, the HTML metadata parser, client fallback/timeout/non-HTML handling, the policy service (bundled → gateway → cache → override), gateway HTTP behavior (limits, cap, token, cache, validation, error mapping), and the Claude request shape.
- `npm run test:e2e`: 76 checks across 6 suites, using the **real gateway server** with the Claude call stubbed. The AI suite proves:
  - a lecture shows "Checking…" and then opens;
  - an entertainment video on the same site is blocked and was fetched only once, for metadata, never rendered;
  - repeat visits use the cache;
  - YouTube-style in-page "next video" is checked;
  - the gateway receives title, genre and a per-video key;
  - stats and insights record the AI decisions;
  - when the gateway stops, offline rules still block.
- `node e2e/run.mjs packaged`: the installed app uses the bundled `resources/policy` rules, runs sandboxed, and blocks in Study Mode.
