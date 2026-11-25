# Phase 7: Daily Browser

Goal: a browser people are comfortable using all day, with its own look, before Study Mode is extended further.

## What changed for users

- **New look ("Paper & Moss").** Warm neutral surfaces, one moss-green accent, hairline borders, a 4px spacing grid and the native Segoe UI Variable font. Light and dark themes, or follow Windows. The chrome is about 80px (tab strip + toolbar) instead of 148px, plus an optional 32px bookmarks bar. When Study Mode is on, the toolbar gets a moss rule along its bottom edge and the Study chip fills with the timer.
- **Tabs:** site icons, loading spinners, audio indicator with mute, pin, drag to reorder, middle-click to close, right-click menu (new tab to the right, reload, duplicate, pin, mute, close others/to the right, reopen closed), double-click the strip to maximize, scrolling when many tabs are open. Links opened with Ctrl/middle-click open in the background next to their tab.
- **Address bar:** shows the domain emphasized with `https://www.` hidden; the full URL appears when you click. Inline autocompletion from history ("you" → youtube.com), and a grouped dropdown: search for the typed text, open tabs ("Switch to this tab"), bookmarks, history, and search suggestions. Lock / "Not secure" / blocked / StudyNest indicator, a zoom chip, an ad-blocker shield with the count of blocked items, and a bookmark star. Shift+Delete removes a highlighted history entry.
- **Built-in pages** (drawn by the browser, not loaded from the web): `studynest://newtab` (search, most visited sites, one-click focus session), `studynest://history` (grouped by day, search, delete entries), `studynest://bookmarks` (search, rename, edit the address, reorder, delete with undo), `studynest://settings` (appearance, search engine, startup, privacy and ad blocking, clear browsing data, site permissions, default browser, account & sync, updates, keyboard shortcuts).
- **Everyday features:** bookmarks bar, browsing history (180 days), find in page (Ctrl+F) with match counts, session restore ("Continue where I left off"), right-click menus in pages (open link in new tab, copy link, save link/image, copy image, search for selection, spelling suggestions, print, inspect), print (Ctrl+P), stop loading, home button, a choice of five search engines, clear browsing data with a time range, and "Make default browser" in installed builds. Opening StudyNest again, or clicking a link in another app, opens a tab in the running window.
- **Ad and tracker blocking:** EasyList / uBlock Origin filter lists through Ghostery's engine. On by default; allow ads per site from the shield in the address bar. Lists are downloaded once and cached (`adblock-engine.bin`), then work offline.
- **Pages drawn by the browser inside tabs** (the Study Mode block page, "Checking page…", and error pages) use the same look and follow the theme.

## Architecture

- `src/main/browser/` holds the new main-process services: `settings` (in `browser-services.ts`), `history-service.ts`, `bookmarks-service.ts`, `session-restore.ts`, `ad-blocker.ts` and `menus.ts` (native menu templates, pure and unit tested). `browser-services.ts` wires them to IPC, the tab manager, native menus and the default-browser API.
- **Built-in pages** use `studynest://` addresses (`shared/internal-pages.ts`). The tab manager keeps the tab's web contents on a blank placeholder document and detaches its view; the renderer draws the page in the content area. This gives the pages the browser's data without exposing anything to websites. Back from the first web page of a tab returns to the built-in page it came from, and Forward returns to the web page without reloading it.
- **One request listener.** Electron allows one `webRequest.onBeforeRequest` listener per session. The tab manager's listener sends top-level navigations to the Study Mode guard and sub-resources to the ad blocker (`setSubresourceFilter`). Ghostery's own `enableBlockingInSession` is not used, because it would replace the Study Mode listener; its cosmetic-filter preload is installed with `session.setPreloads` (Electron 31 has no `registerPreloadScript`).
- **Native menus** (`Menu.popup`) are used for the ⋯ menu and all right-click menus. The OS draws them above the page view, so no overlay tricks are needed, and they follow the theme through `nativeTheme.themeSource`.
- The renderer is split into `components/` (TabStrip, Toolbar, AddressBar, BookmarksBar, FindBar, shared suggestion list) and `pages/`. The chrome reports its height with a ResizeObserver, so the bookmarks bar and find bar push the page down.

## Key rules for future work

- Every tab's web contents must always hold a document. One that never loaded has no renderer, and tools that attach to every page (dev tools, Playwright) stall. Built-in pages and lazily restored tabs load `about:blank`, and the tab ignores that placeholder's own navigation events.
- New request filtering goes through `TabManager`'s single listener, never a second `onBeforeRequest`.
- The ad blocker hides elements with CSS only and never runs the lists' scriptlets: they broke YouTube's player (black video). Redirects to `data:` stand-in scripts crash Electron 31's main process, so they are turned into plain blocks (unit tested).
- Electron's `findInPage({ findNext })` means "start a new search". The browser API's `findNext` means "step to the next match", and the tab manager inverts it.

## Verification

- `npm run verify`: 146 unit tests (history ranking, bookmarks, session restore, settings validation, menu contents, shortcuts, omnibox suggestions and inline completion, URL and search-engine handling).
- `npm run test:e2e`: 101 checks. The new `daily` suite covers the new tab page, Back/Forward between built-in and web pages, history, the bookmark star and bar, find in page, the built-in pages, theme and search engine settings, pinning and reordering, and session restore across a restart. End-to-end runs set `STUDYNEST_ADBLOCK=off` so no filter lists are downloaded; `STUDYNEST_E2E_OUTPUT` moves screenshots and test profiles to another folder.

## Not in this phase

- Private windows and multiple windows (the app is built around one window).
- Password manager and autofill.
- Extensions.
- Bookmark folders and import from other browsers.
