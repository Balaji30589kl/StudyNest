# StudyNest Implementation Guide

This document records how each phase is built, what each phase is responsible for, and how to verify it.

## Phase 1: Browser Shell MVP

Build order:
- Set up Electron main, preload, and React renderer boundaries.
- Create a frameless desktop window and keep window actions behind IPC.
- Manage tabs and navigation in the Electron main process.
- Render the browser chrome in React and keep the web content outside the renderer UI.
- Add shared helpers for URL normalization and browser state contracts.
- Add a small unit test for navigation helpers.

Key implementation rules:
- The renderer only handles chrome, controls, and settings UI.
- The main process owns tab lifecycle, navigation, and BrowserView layout.
- The preload layer exposes only the typed browser API.
- URL input is normalized safely and can fall back to search for plain text.
- The Electron main window must load the emitted preload bundle, which is currently dist-electron/preload/index.mjs in this build setup.

What to verify:
- App launches in development mode.
- Use the Electron window for the real browser shell; opening the Vite localhost page directly is only a renderer preview.
- A default tab opens automatically.
- New tab, switch tab, close tab, back, forward, and refresh all work.
- The address bar accepts URLs and search text.
- The basic homepage setting persists in local storage.
- TypeScript check passes.
- Unit tests pass.
- Production build succeeds.

## Phase 1.1: Omnibox and Search Experience

Build order:
- Add Chrome-like URL versus search classification.
- Add a suggestion dropdown under the address bar.
- Pull search suggestions from DuckDuckGo and mix them with recent entries and open tabs.
- Float the suggestion dropdown over the chrome so tabs stay visible.
- Keep Enter, arrow keys, and click selection working inside the omnibox.

Key implementation rules:
- Bare words should search instead of being treated as hostnames.
- Full URLs should still navigate directly.
- Search result pages should display the search query, not the raw search URL.
- The renderer should keep the BrowserView fixed while the omnibox panel floats above the chrome.

What to verify:
- Typing a word like `youtube` shows search suggestions.
- Typing a domain like `example.com` offers direct navigation.
- Arrow keys move the suggestion highlight.
- Enter submits the selected suggestion.
- Clicking a suggestion navigates correctly.
- The browser shell keeps the tabs visible while suggestions float over the top chrome.

Current output:
- The omnibox now differentiates URL-like input from search queries.
- DuckDuckGo suggestions appear below the address bar.
- Recent entries and current tabs are included in the suggestion list.
- Search pages show the query in the address bar instead of the raw search URL.
- The Electron layout reserves room for the omnibox panel while it is open.

## Phase 2: Study Mode Without AI

Build order:
- Add Study Mode toggle and policy state.
- Introduce allow list and block list handling.
- Add URL and domain monitoring.
- Add block or warning screen behavior.
- Add focus timer, history logging, and notifications.

Key implementation rules:
- Rules live outside the renderer.
- Browser policy must be separate from content classification.
- Study Mode logic should remain simple and deterministic.

What to verify:
- Study Mode can be turned on and off.
- Allowed and blocked pages respond correctly.
- Block screen appears before distracting content becomes visible.

Current output (complete, see `docs/phase-2-study-mode.md`):
- Timed focus sessions with countdown, early stop, auto-complete, a desktop notification, and resume after restart.
- Allow list, block list, strict mode, and block or warn-first enforcement, evaluated by the pure `shared/study-policy.ts`.
- Main-process enforcement through `session.webRequest` before the request is sent, using a generic `NavigationGuard` hook in `TabManager`.
- Tab-bound, single-use "continue anyway" tokens for warn mode, giving per-session overrides.
- Rules can only tighten while a session is running.
- Focus detection (focused, away, times left the app), per-host foreground time, and a history log written only during sessions.
- JSON persistence in `userData/study-data.json` behind a `StudyStore` interface.
- A Study panel drawer. Main shrinks the page view so the drawer is never covered.

## Phase 3: AI Classification

Build order:
- Add metadata extraction from visited pages.
- Send structured metadata to the backend.
- Route requests through the AI gateway.
- Add provider abstraction for rule-based, local, and third-party providers.
- Add classification cache and fallback handling.

Key implementation rules:
- AI predicts categories only.
- Backend applies policy decisions.
- Browser never depends on a specific provider.

What to verify:
- Classification API returns category and confidence.
- Provider swap does not change browser code.
- Cache hits reduce repeated AI calls.

Current output (complete, see `docs/phase-3-ai-classification.md`):
- Sanitized page metadata is extracted in an isolated world, only during sessions and only for unlisted pages.
- `AiGateway` with rule-based (default, offline), local (`/chat/completions`), and Claude (official SDK, structured output) providers.
- A per-host LRU and TTL cache, in-flight de-duplication, a timeout with abort, and fallback to the rule-based provider.
- Predictions feed `applyClassification` in the deterministic policy and can only tighten unlisted pages, above a confidence threshold.
- Cached predictions block repeat visits before the request is sent.
- The API key is encrypted with `safeStorage` and never sent to the renderer.

## Phase 4: Productization

Build order:
- Add analytics and focus insights.
- Add user accounts and sync foundations.
- Add cloud-ready service boundaries.
- Improve observability, release discipline, and resilience.

Key implementation rules:
- Keep product features modular.
- Preserve the classification and policy separation.
- Do not collapse services into a single layer.

What to verify:
- User data can sync safely.
- Dashboards remain decoupled from browser control.
- Production deployment and updates remain predictable.

Current output (complete, see `docs/phase-4-productization.md`):
- A Focus Insights dashboard computed by the pure `shared/insights.ts`. It is read-only, with no browser controls.
- A local profile and device identity; a deterministic sync merge (settings last-writer-wins, immutable sessions unioned) over a `SyncTransport` interface, with a working folder transport.
- Activity log, AI cache, and keys never sync; per-site times are opt-in; newer sync formats are rejected.
- A structured, rotating, redacting logger; crash recovery for tabs and the chrome; About & diagnostics.
- `npm run verify` plus CI on Windows and Ubuntu; versioned, validated persistence files; a changelog.

## Roadmap Status

| Phase | Status | Guide |
|---|---|---|
| 1 Browser Shell MVP | Complete | this file |
| 1.1 Omnibox and Search | Complete | `docs/phase-1-1-omnibox.md` |
| 2 Study Mode without AI | Complete | `docs/phase-2-study-mode.md` |
| 3 AI Classification | Complete | `docs/phase-3-ai-classification.md` |
| 4 Productization | Complete (foundations) | `docs/phase-4-productization.md` |
| 5 Release and Hardening (Windows) | Complete | `docs/phase-5-release-hardening.md` |
| 6 Pre-render AI checks and gateway | Complete | `docs/phase-6-ai-gateway.md` |
| 7 Daily browser (new look, everyday features) | Complete | `docs/phase-7-daily-browser.md` |
| 8 Focus view (in-page distractions during Study Mode) | Complete | `docs/phase-8-focus-view.md` |

Validation gate for every change: `npm run verify` (typecheck, 156 unit tests, app and gateway builds), then `npm run test:e2e` (106 checks against the built app and the real gateway). Before a release: `npm run dist:win` and `node e2e/run.mjs packaged`.

## Phase 5: Release and Hardening (Windows)

Build order:
- Browser basics: shortcuts, window state, downloads.
- Security: permission policy, CSP, sandboxed chrome, trusted IPC, error pages.
- Packaging: NSIS installer and portable build.
- Auto-update via GitHub Releases.
- Release pipeline: e2e suites in the repo, CI e2e, tag-driven draft releases.

Key implementation rules:
- Shortcut mapping, window bounds, permission policy, and error classification stay pure and unit tested; Electron wiring stays thin.
- Every IPC handler is registered through `handleTrusted`.
- The shell keeps its independence: error pages and permissions are shell features and know nothing about Study Mode.

What to verify:
- An installed build updates from a published release.
- Sites cannot use the camera or location without a prompt.
- Shortcuts work while a page has focus.

Current output (complete, see `docs/phase-5-release-hardening.md`).

## Current Phase 1 Output

Current output of the build:
- Electron desktop shell starts in development mode.
- A custom browser UI is rendered in React.
- A default browser tab opens at startup.
- IPC supports tab actions and window controls.
- Browser navigation and history controls are wired.
- Helper tests and production build pass.

## How to Verify Phase 1

Run the following checks:
- `npm run dev`
- `npm run typecheck`
- `npm test`
- `npm run build`

Expected results:
- The dev app opens without runtime errors.
- The window shows tabs, address bar, controls, and status area.
- Navigation actions update the active tab.
- Tests pass.
- Production build completes successfully.

## Notes for Later Phases

- Keep each new phase additive.
- Do not move policy or AI logic into the renderer.
- Keep phase boundaries clean so later swaps stay localized.