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