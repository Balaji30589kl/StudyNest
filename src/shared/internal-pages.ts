/**
 * Built-in pages such as studynest://history. They are drawn by the browser
 * chrome itself in the content area, not loaded into a web page, so they can
 * use the browser's data without exposing it to websites.
 */

export const INTERNAL_PAGES = ['newtab', 'history', 'bookmarks', 'settings'] as const;
export type InternalPage = (typeof INTERNAL_PAGES)[number];

const SCHEME = 'studynest://';

export const NEW_TAB_URL = `${SCHEME}newtab`;

const TITLES: Record<InternalPage, string> = {
  newtab: 'New tab',
  history: 'History',
  bookmarks: 'Bookmarks',
  settings: 'Settings'
};

export function internalUrl(page: InternalPage, section?: string): string {
  return section ? `${SCHEME}${page}#${section}` : `${SCHEME}${page}`;
}

/** The built-in page a URL points to, or null for anything else. */
export function internalPageOf(url: string | null | undefined): InternalPage | null {
  if (!url || !url.toLowerCase().startsWith(SCHEME)) {
    return null;
  }
  const name = url.slice(SCHEME.length).split(/[/?#]/, 1)[0]!.toLowerCase();
  return (INTERNAL_PAGES as readonly string[]).includes(name) ? (name as InternalPage) : null;
}

export function isInternalUrl(url: string | null | undefined): boolean {
  return internalPageOf(url) !== null;
}

/** The part after '#', used to open a page at a section (studynest://settings#privacy). */
export function internalSectionOf(url: string): string | null {
  const index = url.indexOf('#');
  return isInternalUrl(url) && index !== -1 ? url.slice(index + 1) || null : null;
}

export function internalPageTitle(page: InternalPage): string {
  return TITLES[page];
}
