# Phase 5 Release and Hardening Implementation Guide

## Goal
Make StudyNest installable and safe to hand to students on Windows: fill in the missing browser basics, close Electron's insecure defaults, ship an installer that updates itself, and automate releases.

Scope: **Windows only**. Builds are **unsigned** for now, and updates are served from **GitHub Releases**.

## What Was Built

### Browser basics
- **Keyboard shortcuts** (`main/shortcuts.ts`, a pure mapping). They work whether focus is in the toolbar or inside a page, because they are captured with `before-input-event` on both.

  | Keys | Action |
  |---|---|
  | Ctrl+T | New tab (address bar focused) |
  | Ctrl+W, Ctrl+F4 | Close tab |
  | Ctrl+Shift+T | Reopen last closed tab (last 10 kept) |
  | Ctrl+Tab / Ctrl+Shift+Tab, Ctrl+PgDn / Ctrl+PgUp | Next / previous tab |
  | Ctrl+1…8, Ctrl+9 | Go to tab N / last tab |
  | Ctrl+L, Alt+D, F6 | Focus the address bar |
  | F5, Ctrl+R / Ctrl+F5, Ctrl+Shift+R | Reload / reload without cache |
  | Alt+← / Alt+→ | Back / forward |
  | Ctrl+= / Ctrl+- / Ctrl+0 | Zoom in / out / reset |

  Ctrl+Alt combinations are ignored on purpose, because AltGr reports as Ctrl+Alt on Windows keyboards and must keep typing characters.
- **Window state:** size, position, and maximized state persist in `window-state.json`. Saved bounds are reused only if the window's title bar is still on a connected display, and they are clamped to the work area (`resolveWindowBounds`). At fractional display scaling (for example 125%) the size snaps once to whole physical pixels and then stays stable.
- **Downloads:** Electron's save dialog is kept, so the user always chooses where a file goes. A Downloads drawer shows progress, cancel, open, and show-in-folder; it opens automatically when a download starts, and the toolbar shows a count badge.

### Security hardening
- **Site permissions** (`security/permission-policy.ts` is pure; `site-permissions.ts` does the Electron wiring). Electron grants every permission by default. StudyNest now:
  - **Allows** fullscreen and clipboard writes.
  - **Asks** with a native dialog for camera, microphone, location, notifications, clipboard reads, screen sharing, pointer or keyboard lock, MIDI, and opening external apps. Choices can be remembered per site, and duplicate requests share one prompt.
  - **Denies** MIDI sysex, USB, serial, HID, and anything unknown.
  - Remembered choices are listed in Settings → Site permissions, where they can be reset.
- **Content-Security-Policy** on the browser chrome (production builds; the Vite dev server needs inline scripts): `default-src 'none'; script-src 'self'`, with only DuckDuckGo allowed for `connect-src`.
- **Sandboxed chrome:** `sandbox: true` with `contextIsolation`. The preload is now built as CommonJS (`index.cjs`), as sandboxed preloads require.
- **IPC sender checks:** every handler goes through `handleTrusted`, which only accepts calls from the chrome window's top-level frame. Verified by loading the real preload into a second window: its calls are rejected.
- **Chrome lockdown:** the chrome window cannot navigate away or open new windows.
- **Error pages:** a failed main-frame load shows a StudyNest page instead of a blank tab. There are specific messages for certificate errors, being offline, DNS, refused connections, and timeouts. Certificate errors offer no "Try again" or proceed option. Error pages use the interstitial envelope with `kind: 'error'`, so they are never mistaken for Study Mode block pages.

### Installer
- `electron-builder.yml` builds an **NSIS installer** (`StudyNest-Setup-<version>.exe`: per-user, choice of folder, Start menu and desktop shortcuts; app data is kept on uninstall) and a **portable** `.exe`.
- The icon is `build/icon.png`, rendered from SVG by `scripts/generate-icon.cjs`.
- The main process now externalizes runtime dependencies (Anthropic SDK, electron-updater), and electron-builder ships them inside `app.asar`. React moved to devDependencies because Vite bundles it into the renderer.

### Auto-update
- `update/update-service.ts` wraps electron-updater behind an interface so it can be unit tested. It checks 15 seconds after launch and then every 6 hours, downloads in the background, installs on quit, and offers **Restart to update**. A desktop notification appears when an update is ready.
- It is disabled, with an explanation, in development builds and in the portable build (portable executables cannot replace themselves).
- Settings → Updates shows the current version, status, progress, and friendly errors (for example "No published release was found yet.").

### Release pipeline
- The end-to-end suites live in the repo: `e2e/` holds the harness plus suites for study, ai, product, browser, security, and ui, and an opt-in `packaged` suite. They are **hermetic**: a local server stands in for every site, and `localhost` versus `127.0.0.1` provide a blocked host and an allowed host. They run with `npm run test:e2e` after `npm run build`.
- `ci.yml`: verify on Windows and Ubuntu, then e2e on Windows, with screenshots uploaded as an artifact.
- `release.yml`: on a `v*` tag, check the tag matches `package.json`, run verify and e2e, build, publish a **draft** GitHub Release (installer, portable, `latest.yml`, blockmap), and smoke-test the packaged app.

## How to Release
1. Bump `version` in `package.json` and add a `CHANGELOG.md` entry.
2. Commit, then `git tag v0.3.0 && git push origin main --tags`.
3. When the Release workflow finishes, review the draft on GitHub and **publish** it. Installed apps pick it up on their next check.

Local build: `npm run dist:win` writes to `release/<version>/`.

## Verification
- `npm run verify`: typecheck, 115 unit tests (adding shortcuts, window bounds, permission policy, error-page classification, interstitial kinds, and the update lifecycle), and build.
- `npm run test:e2e`: 70 checks across 6 suites, including shortcuts sent as real key events into pages, a real download, window restore after relaunch, a sandbox and CSP probe, rejection of an untrusted IPC sender, scripted permission prompts (block, allow, remembered, device denied, reset), and a connection-refused error page.
- `node e2e/run.mjs packaged`: launches `release/<version>/win-unpacked/StudyNest.exe`, the same files the installer installs. It checks that the app runs packaged from `app.asar` with the sandbox and CSP, that dependencies load from the archive, that updates are enabled and report a clear result, that Study Mode blocks, and that the Settings drawer fits its width.

## Notes and Limits
- **Unsigned builds:** Windows SmartScreen warns on first install ("More info → Run anyway"). Adding a code-signing certificate later only needs `CSC_LINK` and `CSC_KEY_PASSWORD` secrets in CI.
- **Local packaging on Windows:** electron-builder's `winCodeSign` archive contains macOS symlinks, and extracting them needs Developer Mode or admin rights. Either enable Developer Mode, or pre-extract the archive into `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0` without its `darwin` folder (`7za x <archive> -owinCodeSign-2.6.0 -x!darwin`). GitHub's Windows runners are not affected.
- `npx electron-builder --dir` produces an unpacked app **without** `app-update.yml`; only full builds can update.
- Auto-update needs a **public** GitHub repository, or a private repository plus a token, which is not recommended for a desktop app.
