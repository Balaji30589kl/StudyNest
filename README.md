# StudyNest

A focus-first desktop browser for students, built with Electron, React, and TypeScript.

StudyNest is a normal tabbed browser until you switch on **Study Mode**. Then every page is decided before it renders: block-listed sites are blocked, allow-listed study sites open, and everything else is checked by AI. Video sites are judged per video, so a lecture opens and a funny Short doesn't. StudyNest also tracks your focus time and shows what it blocked.

## Install (Windows)

Download `StudyNest-Setup-<version>.exe` from the [Releases page](https://github.com/Balaji30589kl/StudyNest/releases) and run it. Builds are not code-signed yet, so Windows SmartScreen may warn on first run: choose **More info → Run anyway**. Installed copies update themselves. A portable `.exe` is also available, but it doesn't auto-update.

## Features

- **Everyday browser:** tabs with icons, pinning, muting and drag to reorder; an address bar with inline autocomplete and grouped suggestions; bookmarks and a bookmarks bar; history; find in page; session restore; right-click menus; print; five search engines; light and dark themes; built-in ad and tracker blocking. See [Phase 7](docs/phase-7-daily-browser.md).
- **Study Mode:** a toolbar on/off switch plus optional timed sessions (15–90 min); focus tracking and an activity log.
- **Checks before rendering:** backend block and allow lists (domains or paths such as `youtube.com/shorts`), then an AI check through the StudyNest gateway for everything else. It falls back to offline rules when the gateway is unreachable.
- **Focus view:** during Study Mode, hover previews stop playing, YouTube video ads are skipped, and ads are blocked everywhere; recommendations stay visible because anything opened from them is checked first.
- **Insights:** focus time, streaks, distractions blocked (by list vs. AI), pages checked, a category breakdown, most-blocked sites, and a 14-day chart.
- **Sync:** settings and session history sync across devices through a folder you already sync. The activity log and API keys never leave the device.
- **Diagnostics:** structured logs, crash recovery, and an About & diagnostics panel.
- **Windows basics:** keyboard shortcuts, a downloads panel, remembered window size, error pages, permission prompts for camera, microphone, location, and notifications, and "Make default browser".

### Keyboard shortcuts

| Keys | Action |
|---|---|
| Ctrl+T / Ctrl+W / Ctrl+Shift+T | New tab / close tab / reopen closed tab |
| Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+1–9 | Switch tabs |
| Ctrl+L, Alt+D, F6 | Focus the address bar |
| F5 / Ctrl+F5 | Reload / reload without cache |
| Alt+← / Alt+→ | Back / forward |
| Ctrl+= / Ctrl+- / Ctrl+0 | Zoom in / out / reset |
| Ctrl+F / Ctrl+P | Find in page / print |
| Ctrl+D / Ctrl+Shift+B / Ctrl+Shift+O | Bookmark page / bookmarks bar / bookmarks |
| Ctrl+H / Ctrl+J / Ctrl+, | History / downloads / settings |
| Alt+Home / F12 | Home / developer tools |

## Scripts

- `npm run dev`: start the desktop app in development mode, plus the AI gateway when `gateway/.env` has an API key (`npm run dev:app` starts only the app)
- `npm run build`: build production bundles
- `npm run preview`: run the production build
- `npm run typecheck`: TypeScript checks
- `npm test`: unit tests (Vitest)
- `npm run verify`: typecheck, tests, and build. Run this before every merge or release; CI runs it on Windows and Ubuntu.
- `npm run test:e2e`: drives the built app through 106 end-to-end checks (run `npm run build` first)
- `npm run dist:win`: builds the Windows installer and portable app into `release/<version>/`

## Releasing

Bump `version` in `package.json`, update `CHANGELOG.md`, then push a matching tag (`git tag v0.3.0 && git push origin main --tags`). The Release workflow tests, builds, and creates a draft GitHub Release. Publish the draft to roll the update out. Details are in [Phase 5](docs/phase-5-release-hardening.md).

> **Running from VS Code's terminal?** VS Code sets `ELECTRON_RUN_AS_NODE=1`, which makes Electron start as plain Node (`Cannot read properties of undefined (reading 'exports')`). Unset it first: `Remove-Item Env:ELECTRON_RUN_AS_NODE` in PowerShell, or `unset ELECTRON_RUN_AS_NODE` in bash.

## AI gateway (required for AI checks)

The app never holds an LLM key. AI checks go through the small gateway service in `gateway/`, which keeps the LLM key (Claude or Gemini) on the server, rate-limits and caps daily usage. For development:

```
# one-time: copy gateway/.env.example to gateway/.env and set ANTHROPIC_API_KEY
# (or GEMINI_API_KEY with LLM_PROVIDER=gemini)
npm run gateway:build
npm run gateway:start      # http://127.0.0.1:8787, matching config/app.json
npm run dev                # in another terminal
```

Without the gateway, Study Mode still works: lists apply, and unlisted pages are judged by offline keyword rules. See [gateway/README.md](gateway/README.md) for deployment.

## Block and allow lists

The rules are backend files, not app settings: `policy/blocklist.json`, `policy/allowlist.json` and `policy/classification.json` (which categories block, the confidence threshold, and which sites are judged per page). They ship inside the installer and are refreshed from the gateway's `/v1/policy`, so edits on the gateway reach every app.

## Architecture

```
src/
  shared/      pure, tested logic and the typed IPC contract
               url, omnibox helpers, study-policy, classification, insights
  preload/     the only bridge: window.studyNest (typed, narrow)
  renderer/    React browser chrome and panels: display and user intents only
  main/
    tab-manager.ts        browser shell (BrowserViews, navigation)
    navigation-guard.ts   extension point the shell exposes to higher layers
    study/                Study Mode service, store, interstitial
    ai/                   AI gateway, providers, metadata extractor, key storage
    account/ sync/        local profile and device sync
    observability/        logger
    storage/              atomic JSON persistence
```

Rules that keep it maintainable:
- Policy and AI logic never run in the renderer.
- The browser shell knows nothing about Study Mode or AI; they plug in through `NavigationGuard` and page events.
- AI predicts and the deterministic policy decides. Explicit rules always win.
- Every service owns its data behind an interface, which is what makes cloud backends drop-in.

## Documentation

- [Implementation guide](docs/implementation-guide.md): all phases, rules, and verification
- [Phase 1.1: Omnibox](docs/phase-1-1-omnibox.md)
- [Phase 2: Study Mode](docs/phase-2-study-mode.md)
- [Phase 3: AI classification](docs/phase-3-ai-classification.md)
- [Phase 4: Productization](docs/phase-4-productization.md)
- [Phase 5: Release and hardening](docs/phase-5-release-hardening.md)
- [Phase 6: Pre-render AI checks and gateway](docs/phase-6-ai-gateway.md)
- [Changelog](CHANGELOG.md)
