# StudyNest Workspace Instructions

- Phases 1–6 are complete (6: pre-render AI checks through the gateway, backend policy files). See `docs/implementation-guide.md` for status and per-phase guides.
- Keep changes focused; run `npm run verify` and `npm run test:e2e` before considering work done.
- Register IPC handlers with `handleTrusted`, never `ipcMain.handle` directly.
- New site permissions default to deny; add them to `permission-policy.ts` deliberately.
- Keep policy and AI decisions out of the renderer. The renderer displays snapshots and sends intents over typed IPC.
- The browser shell (`TabManager`) stays independent of Study Mode and AI. Integrate only through `NavigationGuard`, `onPageLoaded`, and `onTabCrashed`.
- AI only predicts a category. Enforcement stays in the deterministic `src/shared/study-policy.ts`, and list rules always win.
- The desktop app must never hold an LLM API key; LLM calls belong in `gateway/`.
- Block/allow lists and classification settings live in `policy/*.json`, not in user settings.
- Services own their data behind store interfaces (`StudyStore`, `AiStore`, `SecretStore`, `AccountStore`, `SyncTransport`). Add backends by implementing an interface, not by reaching across layers.
- Never sync or log URLs, page content, or secrets. Logs carry hosts and counts; sync carries settings and session summaries.
- Keep IPC contracts typed and narrow; validate every IPC payload in main.
- Update the docs and `CHANGELOG.md` when behavior or workflow changes.
