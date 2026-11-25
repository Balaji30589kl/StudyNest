# Phase 4 Productization Implementation Guide

## Goal
Take StudyNest from a working feature set to a product foundation: insights people come back to, an account and sync model, clear service boundaries, observability, and predictable releases. The Phase 2/3 policy and classification separation is unchanged.

## What Was Built

### Analytics and focus insights
- `shared/insights.ts`: pure aggregation over finished session summaries. It computes totals, completion rate, focus ratio, current and longest streak (local calendar days, DST-safe), a 14-day daily series, top sites, and the most-focused start hour.
- An Insights drawer: stat tiles, a single-series bar chart (one sequential hue validated against the dark surface, no legend because the title names it, 4px rounded tops anchored to the baseline, 2px gaps, column-wide hover targets with a tooltip, keyboard focus, and a "View as table" alternative), plus patterns and top sites.
- The dashboard is read-only. It receives a snapshot computed in main and has no browser controls.

### Accounts and sync foundations
- `account/account-service.ts`: a local-first profile (id, display name), a device identity, and sync configuration persisted in `userData/account.json`. There is no server login yet; a cloud identity provider can attach to the same profile id later.
- `sync/sync-engine.ts`: a pure, deterministic merge.
  - Settings use last writer wins; ties break on device id, so every device picks the same winner.
  - Session summaries are immutable and unioned by id, capped at 1,000.
  - Documents are validated on read. A file written by a newer StudyNest (`schemaVersion` above what this build supports) is rejected with a clear message and left untouched.
- `sync/sync-transport.ts`: the `SyncTransport` interface, plus `FolderSyncTransport`, which syncs through any folder the user already syncs (OneDrive, Dropbox, iCloud Drive, a network share). Writes are atomic.
- Privacy defaults: the activity log (URLs), AI cache, and API keys **never** sync. Per-site focus times sync only if the user opts in.
- Synced settings go through the same sanitizing and tighten-only rules as local edits, so a remote device cannot loosen rules during a running session.
- Sync runs at startup, 5 seconds after any policy change (debounced), and on **Sync now**. The folder is chosen with a native dialog in main; the renderer can only turn sync off.

### Observability and resilience
- `observability/logger.ts`: structured JSON-lines logs in `userData/logs/studynest.log`, rotated at 1 MB with one backup. Keys matching key/token/secret/password are redacted. An in-memory ring holds recent warnings and errors for diagnostics. By convention the log holds hosts and counts, never URLs or page content.
- Uncaught exceptions and unhandled rejections are logged.
- A crashed tab renderer is reloaded automatically up to 2 times, then the tab shows "Page crashed. Press Refresh to retry." A crashed chrome renderer is reloaded up to 3 times.
- About & diagnostics in Settings: version, Electron/Chromium, platform, log path, and recent problems.

### Release discipline
- `npm run verify` runs typecheck, tests, and build: the single gate before any merge or release.
- `.github/workflows/ci.yml` runs `verify` on Windows and Ubuntu for pushes and PRs.
- `CHANGELOG.md`; version 0.2.0 (shown in diagnostics).
- Every persisted file carries a schema version and is parsed through a validator that falls back to safe defaults: `study-data.json`, `ai-data.json`, `account.json`, and the sync document.

## Service Boundaries

```
renderer ── typed IPC (preload) ──► main composition root (main/index.ts)
                                     ├─ TabManager             browser shell, NavigationGuard + page/crash events
                                     ├─ StudyModeService       deterministic policy, sessions, history   (StudyStore)
                                     ├─ AiGateway              predictions only, providers + cache      (AiStore, SecretStore)
                                     ├─ AccountService         profile, device, sync orchestration      (AccountStore, SyncTransport)
                                     └─ Logger                 observability
```

Each service owns its data behind a store interface and has no Electron import (except the thin adapters: metadata extractor, safeStorage secret store, product IPC). That is what makes them cloud-ready. For example, a hosted sync service is a new `SyncTransport`, and a server-side classifier is a new `ClassificationProvider`. Neither needs a change to the shell or the policy layer.

Dependencies point one way: account → study (through `SyncParticipant`), study → AI cache (through `classificationLookup`), and shell → nothing (through the `NavigationGuard` interface).

## Verification

Automated (`npm run verify`, 95 tests):
- Insights: empty history, totals and series, top hosts, best hour, and streaks including a missed day.
- Sync engine: first document, opt-in browsing details, union and import, last writer wins with tie-break, and rejection of foreign or newer formats.
- Two devices syncing through a real temporary folder converge on settings and sessions; the shared file contains no activity log or per-site times.
- A corrupt sync file is reported and left untouched; synced settings respect tighten-only during a session.
- Logger: levels, redaction, rotation, and recent problems.

End to end (built app, two isolated profiles, only the native folder dialog stubbed):
1. Insights aggregate sessions, and the chart and tooltip render.
2. Device A syncs to a folder; the sync file is written.
3. Diagnostics report version 0.2.0 and a real log file.
4. A tab renderer crashed with `forcefullyCrashRenderer` reloads and the crash is logged.
5. Device B joins the same folder and receives A's sessions and block list. Both devices are registered and the file has no activity log.

## Known Limits and Next Steps
- No packaged installer or auto-update yet. Next: electron-builder with code signing, plus `electron-updater` against a release channel. The CI gate is already in place.
- Folder sync is last-writer-wins at file level between concurrent writers. The merge-on-every-sync design converges on the next sync, but a hosted transport with compare-and-swap would close that window.
- Accounts are local. A real identity provider (OAuth) would attach to `profile.id`.
- On macOS, `activate` re-runs initialization and would re-register IPC handlers. This is inherited from Phase 1; the main target today is Windows.
