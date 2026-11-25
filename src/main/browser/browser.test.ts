import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { adBlockingActiveFor, DEFAULT_BROWSER_SETTINGS, sanitizeBrowserSettings } from '../../shared/browser-settings.js';
import { internalPageOf, internalSectionOf, internalUrl, isInternalUrl } from '../../shared/internal-pages.js';
import { BookmarksService, parseBookmarks, PersistedBookmarks } from './bookmarks-service.js';
import { HistoryService, parseHistory, PersistedHistory } from './history-service.js';
import { buildAppMenu, buildPageMenu, buildTabMenu, PageMenuActions } from './menus.js';
import { parseSavedSession, toSavedSession } from './session-restore.js';

function memoryStore<T>(initial: T) {
  let data = initial;
  return { load: () => data, save: vi.fn((next: T) => (data = JSON.parse(JSON.stringify(next)))), flush: vi.fn(), get: () => data };
}

const DAY = 24 * 60 * 60 * 1000;

describe('history', () => {
  function history(now = { t: 1_000 * DAY }) {
    const store = memoryStore<PersistedHistory>({ version: 1, entries: [] });
    return { service: new HistoryService(store, () => now.t), store, now };
  }

  it('records web visits only and merges quick revisits of the same page', () => {
    const { service, now } = history();
    service.record('https://example.com/a', 'A');
    service.record('studynest://history', 'History');
    service.record('data:text/html,x', 'x');
    now.t += 10_000;
    service.record('https://example.com/a', 'A (updated)');
    expect(service.query()).toHaveLength(1);
    expect(service.query()[0]).toMatchObject({ title: 'A (updated)', host: 'example.com' });
    now.t += 5 * 60_000;
    service.record('https://example.com/a', 'A');
    expect(service.query()).toHaveLength(2);
  });

  it('fills in titles that arrive after the visit', () => {
    const { service } = history();
    service.record('https://example.com/', '');
    service.updateTitle('https://example.com/', 'Example Domain');
    expect(service.query()[0]!.title).toBe('Example Domain');
  });

  it('searches newest first and pages with "before"', () => {
    const { service, now } = history();
    for (const [index, title] of ['Linear algebra lecture', 'Cat videos', 'Linear regression'].entries()) {
      now.t += 60 * 60_000;
      service.record(`https://site${index}.test/`, title);
    }
    expect(service.query({ text: 'linear' }).map((entry) => entry.title)).toEqual(['Linear regression', 'Linear algebra lecture']);
    const newest = service.query({ limit: 1 })[0]!;
    expect(service.query({ before: newest.visitedAt }).map((entry) => entry.title)).toEqual(['Cat videos', 'Linear algebra lecture']);
  });

  it('ranks address-bar suggestions by host match, frequency and recency', () => {
    const { service, now } = history();
    service.record('https://news.example.com/youtube-story', 'Story about youtube');
    for (let index = 0; index < 5; index += 1) {
      now.t += 5 * 60_000;
      service.record('https://www.youtube.com/', 'YouTube');
    }
    now.t += 5 * 60_000;
    service.record('https://www.youtube.com/watch?v=1', 'A video');
    const result = service.suggest('youtube');
    expect(result[0]).toMatchObject({ url: 'https://www.youtube.com/', visits: 5 });
    expect(result.map((entry) => entry.url)).toContain('https://news.example.com/youtube-story');
    expect(service.suggest('')).toEqual([]);
  });

  it('lists most visited sites and drops visits older than 180 days on load', () => {
    const now = 1_000 * DAY;
    const store = memoryStore<PersistedHistory>(
      parseHistory({
        entries: [
          { id: 'old', url: 'https://old.test/', title: 'Old', visitedAt: now - 200 * DAY },
          { id: '1', url: 'https://a.test/x', title: 'A x', visitedAt: now - DAY },
          { id: '2', url: 'https://a.test/', title: 'A home', visitedAt: now - DAY + 1 },
          { id: '3', url: 'https://b.test/', title: 'B', visitedAt: now - DAY + 2 },
          { id: 'bad', url: 5 }
        ]
      })
    );
    const service = new HistoryService(store, () => now);
    expect(service.query().map((entry) => entry.id)).toEqual(['3', '2', '1']);
    expect(service.topSites()).toEqual([
      { url: 'https://a.test/', host: 'a.test', title: 'A home', visits: 2 },
      { url: 'https://b.test/', host: 'b.test', title: 'B', visits: 1 }
    ]);
  });

  it('deletes entries and clears a time range', () => {
    const { service, now } = history();
    service.record('https://a.test/', 'A');
    now.t += DAY;
    service.record('https://b.test/', 'B');
    const [b] = service.query();
    service.delete([b!.id]);
    expect(service.query().map((entry) => entry.title)).toEqual(['A']);
    now.t += DAY;
    service.record('https://c.test/', 'C');
    service.clear(now.t - 60_000);
    expect(service.query().map((entry) => entry.title)).toEqual(['A']);
    service.clear();
    expect(service.query()).toEqual([]);
  });
});

describe('bookmarks', () => {
  it('adds, toggles, renames, moves and removes web pages only', () => {
    const store = memoryStore<PersistedBookmarks>({ version: 1, bookmarks: [] });
    const service = new BookmarksService(store, () => 5);
    const changes = vi.fn();
    service.onChange(changes);
    service.add('https://a.test/', 'A');
    service.add('https://a.test/', 'A again');
    service.add('studynest://settings', 'Settings');
    service.toggle('https://b.test/', '  ');
    expect(service.list().map((bookmark) => [bookmark.url, bookmark.title])).toEqual([
      ['https://a.test/', 'A'],
      ['https://b.test/', 'b.test']
    ]);
    const [a, b] = service.list();
    service.update(a!.id, { title: ' Renamed  site ', url: 'javascript:alert(1)' });
    expect(service.list()[0]).toMatchObject({ title: 'Renamed site', url: 'https://a.test/' });
    service.move(b!.id, 0);
    expect(service.list().map((bookmark) => bookmark.url)).toEqual(['https://b.test/', 'https://a.test/']);
    service.toggle('https://b.test/', 'B');
    expect(service.isBookmarked('https://b.test/')).toBe(false);
    expect(changes).toHaveBeenCalled();
    expect(parseBookmarks({ bookmarks: [{ id: 1 }, ...store.get().bookmarks] }).bookmarks).toHaveLength(1);
  });
});

describe('session restore', () => {
  it('keeps web and built-in pages, drops anything else and clamps the active index', () => {
    const saved = toSavedSession(
      [
        { url: 'https://a.test/', title: 'A', pinned: true },
        { url: 'data:text/html,blocked', title: 'x', pinned: false },
        { url: 'studynest://history', title: 'History', pinned: false }
      ],
      7
    );
    expect(saved.tabs.map((tab) => tab.url)).toEqual(['https://a.test/', 'studynest://history']);
    expect(saved.activeIndex).toBe(1);
    expect(parseSavedSession('garbage')).toEqual({ version: 1, tabs: [], activeIndex: 0 });
  });
});

describe('settings and internal pages', () => {
  it('validates settings and keeps defaults for bad values', () => {
    expect(sanitizeBrowserSettings({ theme: 'neon', searchEngine: 'google', adBlockExceptions: ['WWW.News.com', 'bad host', 'news.com'] })).toEqual({
      ...DEFAULT_BROWSER_SETTINGS,
      searchEngine: 'google',
      adBlockExceptions: ['news.com']
    });
  });

  it('turns ad blocking off for excepted sites and their subdomains', () => {
    const settings = { ...DEFAULT_BROWSER_SETTINGS, adBlockExceptions: ['news.com'] };
    expect(adBlockingActiveFor(settings, 'www.news.com')).toBe(false);
    expect(adBlockingActiveFor(settings, 'm.news.com')).toBe(false);
    expect(adBlockingActiveFor(settings, 'othernews.com')).toBe(true);
    expect(adBlockingActiveFor({ ...settings, adBlocking: false }, 'x.com')).toBe(false);
  });

  it('recognises built-in page addresses', () => {
    expect(internalPageOf('studynest://settings#privacy')).toBe('settings');
    expect(internalPageOf('StudyNest://History')).toBe('history');
    expect(internalPageOf('studynest://unknown')).toBeNull();
    expect(isInternalUrl('https://studynest.app')).toBe(false);
    expect(internalSectionOf(internalUrl('bookmarks', 'edit=1'))).toBe('edit=1');
  });
});

describe('menus', () => {
  const actions: PageMenuActions = {
    searchEngineName: 'DuckDuckGo',
    canGoBack: true,
    canGoForward: false,
    openInNewTab: vi.fn(),
    copyText: vi.fn(),
    copyImageAt: vi.fn(),
    download: vi.fn(),
    searchFor: vi.fn(),
    replaceMisspelling: vi.fn(),
    addToDictionary: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    reload: vi.fn(),
    print: vi.fn(),
    inspect: vi.fn()
  };
  const params = (overrides: Partial<ContextMenuParams> = {}) =>
    ({
      x: 1,
      y: 2,
      linkURL: '',
      srcURL: '',
      mediaType: 'none',
      hasImageContents: false,
      isEditable: false,
      selectionText: '',
      misspelledWord: '',
      dictionarySuggestions: [],
      editFlags: { canUndo: true, canRedo: false, canCut: true, canCopy: true, canPaste: true, canDelete: true, canSelectAll: true, canEditRichly: false },
      ...overrides
    }) as ContextMenuParams;
  const labels = (items: MenuItemConstructorOptions[]) => items.map((item) => (item.type === 'separator' ? '---' : (item.label ?? item.role)));

  it('builds page menus for links, selections, inputs and empty space', () => {
    expect(labels(buildPageMenu(params({ linkURL: 'https://a.test/' }), actions))).toEqual(['Open link in new tab', 'Copy link address', 'Save link as…', '---', 'Inspect']);
    expect(labels(buildPageMenu(params({ selectionText: 'eigenvalues of a matrix are' }), actions))).toEqual([
      'copy',
      'Search DuckDuckGo for “eigenvalues of a matrix are”',
      '---',
      'Inspect'
    ]);
    expect(labels(buildPageMenu(params({ isEditable: true, misspelledWord: 'teh', dictionarySuggestions: ['the', 'tech'] }), actions)).slice(0, 4)).toEqual([
      'the',
      'tech',
      'Add to dictionary',
      '---'
    ]);
    expect(labels(buildPageMenu(params(), actions))).toEqual(['Back', 'Forward', 'Reload', '---', 'Select all', 'Print…', '---', 'Inspect']);
    expect(labels(buildPageMenu(params({ linkURL: 'javascript:void(0)' }), actions))).not.toContain('Open link in new tab');
  });

  it('offers pin, mute and close actions on tabs', () => {
    const tabMenu = buildTabMenu({
      pinned: true,
      muted: false,
      isOnlyTab: false,
      hasTabsToRight: false,
      canReopen: true,
      newTabToRight: vi.fn(),
      reload: vi.fn(),
      duplicate: vi.fn(),
      togglePin: vi.fn(),
      toggleMute: vi.fn(),
      close: vi.fn(),
      closeOthers: vi.fn(),
      closeToRight: vi.fn(),
      reopenClosed: vi.fn()
    });
    expect(labels(tabMenu)).toContain('Unpin');
    expect(labels(tabMenu)).toContain('Mute tab');
    expect(tabMenu.find((item) => item.label === 'Close tabs to the right')?.enabled).toBe(false);
  });

  it('shows zoom level and the bookmarks bar state in the app menu', () => {
    const menu = buildAppMenu({
      zoomPercent: 125,
      canZoom: true,
      showBookmarksBar: true,
      studyActive: false,
      newTab: vi.fn(),
      reopenClosed: vi.fn(),
      openPage: vi.fn(),
      openPanel: vi.fn(),
      zoom: vi.fn(),
      find: vi.fn(),
      print: vi.fn(),
      toggleBookmarksBar: vi.fn(),
      clearData: vi.fn(),
      quit: vi.fn()
    });
    expect(labels(menu)).toContain('Zoom (125%)');
    expect(menu.find((item) => item.label === 'Show bookmarks bar')?.checked).toBe(true);
  });
});

describe('ad blocker request filter', () => {
  it('turns stand-in data: redirects into plain blocks (they crash Electron 31) and skips excepted sites', async () => {
    const { AdBlocker } = await import('./ad-blocker.js');
    let active = true;
    const blocker = new AdBlocker({
      session: {} as never,
      cacheFile: 'unused',
      fetchImpl: vi.fn(),
      isActiveFor: () => active,
      isChrome: () => false,
      log: vi.fn()
    });
    const responses: Array<Record<string, unknown>> = [];
    (blocker as unknown as { engine: unknown }).engine = {
      onBeforeRequest: (details: { url: string }, callback: (response: Record<string, unknown>) => void) =>
        callback(details.url.includes('analytics') ? { redirectURL: 'data:text/javascript,' } : details.url.includes('ads') ? { cancel: true } : {})
    };
    const run = (url: string) => blocker.filter({ url } as never, 'https://site.test/', (response) => responses.push(response as Record<string, unknown>));
    run('https://cdn.test/analytics.js');
    run('https://cdn.test/ads.js');
    run('https://cdn.test/app.js');
    active = false;
    run('https://cdn.test/ads.js');
    expect(responses).toEqual([{ cancel: true }, { cancel: true }, {}, {}]);
    expect(blocker.getState().totalBlocked).toBe(2);
  });
});
