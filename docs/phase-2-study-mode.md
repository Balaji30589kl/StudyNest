# Phase 2 Study Mode Implementation Guide

## Goal
Add a deterministic Study Mode: a timed focus session with allow and block list enforcement, focus tracking, and history logging. There is no AI here. Every decision comes from explicit rules.

## What Was Built
- Focus sessions with presets (15–90 min, clamped to 5–240), countdown, early stop, and auto-complete on a main-process timer.
- Allow list, block list, and **strict mode**, where only allow-listed sites (plus search) may open.
- Two enforcement styles. **Block** shows an interstitial with no way through. **Warn first** shows an interstitial with a "Continue anyway (logged)" link that grants a per-session override for that host.
- Blocked pages are cancelled *before the request is sent*, so distracting content never renders.
- Re-validation of open tabs whenever policy changes. Starting a session intercepts tabs that are already open on blocked sites, and ending one restores them.
- Tighten-only rules during a session: block list entries can be added but not removed, allow list entries removed but not added, warn can become block, and strict mode can be turned on but not off.
- Focus detection: time with the window focused vs. away, the number of times the user left the app, and foreground time per host.
- History log of session start/end, visits, blocks, warnings, overrides, and focus changes. **Nothing is logged outside a session.**
- Desktop notification when a session completes.
- A session that is still running survives an app restart. Downtime counts as neither focused nor away time.
- Study panel drawer in the renderer: session card, stats, top sites, rules editor, recent activity, and clear history.

## Architecture

```
renderer (StudyPanel, toolbar pill)      display + intents only
   │  typed IPC: study:*  /  browser:set-content-inset-right
preload (window.studyNest)
   │
main/index.ts            wires service ↔ tab manager ↔ IPC ↔ window focus
   ├─ study/study-mode-service.ts   session, policy context, stats, history
   │     ├─ shared/study-policy.ts  pure deterministic rules (also used by tests)
   │     ├─ study/interstitial-page.ts  block/warn page HTML
   │     └─ study/study-store.ts    JSON persistence (userData/study-data.json)
   └─ tab-manager.ts        enforces through the generic NavigationGuard hook
         └─ navigation-guard.ts     shell-level interface, no Study knowledge
```

Key boundaries:
- **The shell does not know about Study Mode.** `TabManager` accepts any `NavigationGuard` and works without one. The guard returns `allow | cancel | redirect | intercept`.
- **Policy is pure.** `evaluateStudyPolicy(url, context)` has no I/O. Precedence: study off → internal pages → session overrides → the most specific allow/block rule (block wins ties) → search engine → unlisted handling.
- **The service has no Electron dependency.** Its clock, timer, ID source, notifications, and store are injected, so it is fully unit tested.
- **The renderer only displays.** It never evaluates rules. Settings arriving over IPC are sanitized in main (`sanitizeStudySettings`) and tightened if a session is active.

## How Enforcement Works
1. Every top-level `http(s)` request in a tab passes through `session.webRequest.onBeforeRequest`.
2. `TabManager` asks the guard. If the answer is not `allow`, the request is cancelled and the decision is applied on the next tick.
3. `intercept` loads a `data:` interstitial. The URL fragment records the blocked target (`#studynest-blocked=…`), so the tab keeps showing the real URL in the address bar and any interstitial found in history maps back to its target.
4. The warn link points at `https://proceed.studynest.invalid/?token=…`. The token is random, single use, and bound to the tab, so a web page cannot grant itself an override. The guard turns a valid token into a `redirect` back to the target.
5. `did-navigate` re-checks committed pages as a backstop for navigations that skip the network (history restores).

## Native View Layout
The page `BrowserView` is a native layer above the renderer. Side panels therefore ask main to reserve space (`setContentInsetRight`), and the page shrinks rather than covering the drawer. The Settings popover was moved into the same drawer for this reason; at its old position it rendered under the page.

## Verification

Automated:
- `npm run typecheck`
- `npm test`: policy rules, the tighten-only rule, service sessions/stats/overrides/persistence, the store, interstitial escaping, and formatting.
- `npm run build`

Manual (`npm run dev`):
1. Click **Study Mode**, choose 15m, and click **Start**. The toolbar pill counts down.
2. Open `reddit.com`. The block interstitial appears and the tab chip reads "Blocked · reddit.com".
3. End the session. The tab restores to reddit.
4. Set **Warn first**, save, and start a session. The reddit tab switches to the warning page. **Continue anyway** opens it and logs an override.
5. During the session, try removing a block list entry. It stays.
6. Switch to another app and back. "Times left app" goes up.

Known caveat: when running from inside VS Code's integrated terminal, `ELECTRON_RUN_AS_NODE=1` is inherited and Electron starts as plain Node (`Cannot read properties of undefined (reading 'exports')`). Unset it before `npm run dev` or `npm run preview`.

## Notes
- Overrides last only for the current session.
- Phase 3 adds classification as an **input** to this policy. It must not replace the deterministic enforcement path built here.
