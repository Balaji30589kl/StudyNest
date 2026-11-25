import { isInternalUrl } from '../../shared/internal-pages.js';

/** The open tabs, saved continuously so they can be reopened after a restart or crash. */
export type SavedSession = {
  version: 1;
  tabs: Array<{ url: string; title: string; pinned: boolean }>;
  activeIndex: number;
};

const MAX_TABS = 100;

function isRestorableUrl(url: unknown): url is string {
  return typeof url === 'string' && (/^https?:\/\//i.test(url) || isInternalUrl(url));
}

export function parseSavedSession(raw: unknown): SavedSession {
  const candidate = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const tabs = Array.isArray(candidate.tabs)
    ? candidate.tabs
        .filter((tab): tab is Record<string, unknown> => typeof tab === 'object' && tab !== null && isRestorableUrl((tab as Record<string, unknown>).url))
        .slice(0, MAX_TABS)
        .map((tab) => ({ url: tab.url as string, title: typeof tab.title === 'string' ? tab.title : '', pinned: tab.pinned === true }))
    : [];
  const activeIndex = typeof candidate.activeIndex === 'number' && Number.isInteger(candidate.activeIndex) ? candidate.activeIndex : 0;
  return { version: 1, tabs, activeIndex: Math.min(Math.max(activeIndex, 0), Math.max(tabs.length - 1, 0)) };
}

/**
 * What to save for a set of tabs. Pages blocked by Study Mode are saved as
 * their real address, so they are checked again when restored.
 */
export function toSavedSession(tabs: Array<{ url: string; title: string; pinned: boolean }>, activeIndex: number): SavedSession {
  return parseSavedSession({ version: 1, tabs, activeIndex });
}
