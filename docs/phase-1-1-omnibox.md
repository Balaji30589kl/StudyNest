# Phase 1.1 Omnibox Implementation Guide

## Goal
Add a Chrome-like omnibox to StudyNest without introducing Study Mode or AI policy logic.

## What Was Built
- URL versus search classification for address bar input.
- Search suggestions from DuckDuckGo.
- Suggestions from recent entries and open tabs.
- Keyboard navigation for suggestions.
- Click-to-select suggestion behavior.
- Dynamic Electron chrome height while the suggestion panel is open.
- Search result display formatting so the query is visible instead of the raw search URL.
- Floating suggestion dropdown that overlays the browser chrome instead of pushing tabs down.
- Branded in-app landing page for new tabs instead of Example Domain.

## Key Design Choices
- Bare words are treated as searches.
- URL-like input still navigates directly.
- Suggestion logic stays in the renderer.
- The main process still owns browser navigation and BrowserView layout.
- The renderer asks the main process to resize the chrome when the suggestion panel opens or closes.
- The suggestion panel now floats over the shell so the tabs row remains visible.
- The landing page is shared between renderer and main process so both use the same start page.

## How It Works
1. The user types into the address bar.
2. The renderer classifies the input as a URL or search query.
3. The renderer fetches DuckDuckGo suggestions and combines them with local recents and tabs.
4. The suggestion panel renders under the address bar.
5. Arrow keys, Enter, and mouse clicks submit the selected suggestion.
6. The main process normalizes the final navigation target and loads it in the active tab.

## Verification
Run these checks:
- `npm run dev`
- `npm run typecheck`
- `npm test`
- `npm run build`

Expected results:
- Search queries produce suggestions and open search results.
- Domains still open directly.
- The suggestion panel appears and collapses correctly.
- The browser shell remains stable and responsive.

## Notes
- This phase is intentionally limited to the browser shell and search UX.
- No Study Mode, policy, or AI logic was added here.
