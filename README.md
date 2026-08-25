# StudyNest

Phase 1 browser shell for the StudyNest desktop browser.

## What is here

- Electron desktop shell
- React + TypeScript renderer chrome
- Tab management in the main process
- Browser navigation, back, forward, refresh
- Basic local settings for the homepage
- Shared IPC and URL normalization helpers
- A small Vitest setup for core helpers

## Scripts

- `npm run dev` - start the desktop app in development mode
- `npm run build` - build the production app bundles
- `npm run preview` - preview the production Electron build
- `npm run typecheck` - run TypeScript checks
- `npm run test` - run unit tests

## Notes

- Phase 1 intentionally excludes AI and Study Mode.
- The browser shell keeps rendering control in Electron main and presentation in React.
- Web content is loaded in native browser views managed by the main process.
