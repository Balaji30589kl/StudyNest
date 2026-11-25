# Changelog

All notable changes to StudyNest. Versions follow semantic versioning while pre-1.0: minor versions may change behavior.

## Unreleased

### Added
- **A new look and a complete everyday browser (Phase 7).** A compact two-row chrome with its own design (light, dark or follow Windows); tabs with site icons, pinning, muting, drag to reorder and a right-click menu; an address bar with inline autocomplete, grouped suggestions (tabs, bookmarks, history, search), a security indicator, zoom chip and bookmark star; bookmarks and a bookmarks bar; browsing history; find in page; session restore; right-click menus in pages; print; a choice of search engines; clear browsing data; "Make default browser"; and built-in pages for the new tab, history, bookmarks and settings. Details: `docs/phase-7-daily-browser.md`.
- **Ad and tracker blocking** with the EasyList / uBlock Origin lists, on by default, with a per-site switch in the address bar.
- Opening StudyNest again, or clicking a link in another app, opens a tab in the running window.
- **Search box on blocked YouTube pages.** The YouTube homepage feed stays blocked during Study Mode, but its block page now offers a YouTube search.
- **Gemini support in the AI gateway.** Set `LLM_PROVIDER=gemini` and `GEMINI_API_KEY`. When a Gemini model is overloaded or retired, the gateway tries the models in `GEMINI_FALLBACK_MODELS`.

### Changed
- **YouTube searches are checked, not always allowed.** `youtube.com/results` is off the allow list. Each search is judged by its query ("linear algebra lecture" opens, "funny comedy videos" is blocked), including searches typed into YouTube's own search box.
- Settings moved from a side drawer to a full page (`studynest://settings`). The block, checking and error pages use the new look.

### Fixed
- **YouTube videos stayed black with the ad blocker on.** The filter lists' injected scripts broke YouTube's player, and their stand-in `data:` redirects crash Electron 31. Ads are now blocked by request and hidden with CSS only; scripts are never injected, and redirects become plain blocks.
- **Sports videos were allowed in Study Mode.** There was no sports category, and when the AI gateway was unreachable, unidentified videos were let through. Added a "sports" category (distracting by default, also known to the offline rules), and videos the classifier can't identify now stay blocked (`blockUnclearPerPage` in `policy/classification.json`).
- **AI checks often fell back to the offline rules.** Gemini (especially on the free tier) sometimes takes 5–30 s, while the app gave up after 6 s and kept the offline guess for 30 minutes. The gateway now races its models (the next one starts after 2.5 s or on an error), the app waits up to 10 s, unclear offline guesses are retried after 15 s, and the offline rules know common study terms (java, DSA, one shot, JEE, NEET, NCERT…).
- `npm run dev` now also starts the AI gateway when `gateway/.env` has a key, and the Study chip shows a warning dot when AI checks are offline.
- `.env.example` files were hidden by the `.env.*` ignore rule, so the gateway's setup template was missing from git.
- A YouTube page was checked twice, with a reload, because YouTube adds `themeRefresh=1` to the address after loading. That parameter no longer counts as a different page.
- **YouTube videos were judged from an empty page.** YouTube often answers the app's background metadata request with a 429 "unusual traffic" page, which was read as the video, so every video was judged by its URL alone. Error responses, bot checks and consent walls are now treated as refused, and YouTube and Vimeo titles and channels come from oEmbed instead.

## 0.4.0 - 2026-11-14

### Changed
- **Pages are checked before they render.** During Study Mode, block-listed pages are blocked, allow-listed pages open, and every other page is checked by AI behind a "Checking page…" screen.
- **Video sites are judged per video:** a lecture opens, while a Short or a comedy clip on the same site is blocked. This includes YouTube's in-page "next video" changes.
- **Block and allow lists are backend files** (`policy/`). They are not editable in the app and are refreshed from the gateway. Rules can target paths (`youtube.com/shorts`).
- **Study Mode is an on/off switch** in the toolbar, with optional timed sessions.
- **The LLM is reached only through the new StudyNest AI gateway** (`gateway/`), which holds the API key, rate-limits, caps daily requests and caches per page. The app no longer stores API keys or offers provider settings.
- Analytics add blocked-by-list vs. by-AI counts, pages checked, a category breakdown, most-blocked sites and a daily blocked count.

### Removed
- Warn mode and "Continue anyway", tighten-only and strict-mode settings, the in-app rule editor, and the AI provider/model/API-key settings.

### Fixed
- Per-page cache keys now keep content-identifying query parameters, so two videos on the same site never share a verdict.
- The "Checking page…" screen could commit after its verdict and mislabel an AI block as a list block.

## 0.3.0 - 2026-11-13

### Added
- **Windows installer and portable build**, with an app icon and the StudyNest name.
- **Automatic updates** from GitHub Releases: background download and "Restart to update" in Settings.
- **Keyboard shortcuts:** Ctrl+T/W/Shift+T, Ctrl+Tab, Ctrl+1–9, Ctrl+L/Alt+D/F6, F5/Ctrl+R, Alt+←/→, Ctrl+=/−/0. They work inside pages too.
- **Downloads panel** with progress, cancel, open, and show-in-folder.
- **Site permission prompts** for camera, microphone, location, notifications, and more, with remembered choices and a reset list in Settings. Device access (USB, serial, HID, MIDI sysex) is always blocked.
- **Error pages** for unreachable sites, being offline, DNS failures, and untrusted certificates.
- The window remembers its size, position, and maximized state.
- End-to-end test suites in the repo (`npm run test:e2e`), a CI e2e job, and a tag-driven release workflow.

### Security
- The browser chrome runs sandboxed, has a Content-Security-Policy, cannot navigate away, and main only accepts IPC from it.
- Web pages no longer receive permissions silently (Electron's default).

### Fixed
- A tab that was just unblocked could briefly keep stale block state if a new session started while it reloaded.
- Long log lines or paths could widen the Settings drawer and push buttons out of view.
- Omnibox suggestions were hidden behind the web page. While you type, the page is shown as a still image and the live page view is hidden, so the dropdown is fully visible. The dropdown is now anchored under the address bar.
- Tabs with long titles overflowed into each other, and the close button overlapped the text. Tabs now have a uniform width with ellipsis, a real close button, and a loading spinner. The full title and URL show on hover.
- The Homepage setting showed a long raw `data:` URL. It is now empty with a "StudyNest start page" placeholder.
- Disabled buttons no longer move on hover. The address bar has a focus ring, and the window controls use crisp icons.
- Theme-matched thin scrollbars; the session length chips fit on one row.
- Removed a hidden "Ready" status badge that could show through behind overlays.

## 0.2.0 - 2026-11-12

### Added
- **Study Mode (Phase 2):** timed focus sessions; allow list, block list, and strict mode; block or warn-first enforcement before any content renders; per-session "continue anyway" overrides; rules that can only tighten during a session; focus and away tracking; a session-only activity log; desktop notifications; resuming a running session after restart.
- **AI classification (Phase 3):** an AI gateway with an offline keyword provider (default), a local model server provider, and a Claude provider (Anthropic SDK, structured output). Predictions only affect unlisted sites, above a confidence threshold, and default to warn. Includes a per-host cache, fallback, timeouts, and an API key encrypted with the OS keychain.
- **Productization (Phase 4):** a Focus Insights dashboard (streaks, completion, a 14-day chart, top sites); a local profile and folder-based sync of settings and session history between devices; structured rotating logs; crash recovery for tabs and the browser chrome; About & diagnostics.
- Side panel drawers. The page view now shrinks to make room, so panels are never covered by web content.
- `npm run verify` and a CI workflow (Windows and Ubuntu).

### Changed
- Settings moved from a popover into a drawer, because the old popover rendered underneath the page view.
- Closed tabs now release their web contents.

## 0.1.0

- Phase 1 browser shell (tabs, navigation, typed IPC) and Phase 1.1 omnibox (search vs. URL classification, suggestions, landing page).
