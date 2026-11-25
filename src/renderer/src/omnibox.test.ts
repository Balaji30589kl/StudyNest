import { describe, expect, it } from 'vitest';
import type { BrowserTabState } from '../../shared/ipc.js';
import { buildOmniboxSuggestions, inlineCompletion, OmniboxSources, typedForm } from './omnibox.js';

function tab(id: string, title: string, url: string): BrowserTabState {
  return { id, title, url, canGoBack: false, canGoForward: false, isLoading: false, blocked: null, checking: false, favicon: null, audible: false, muted: false, pinned: false, zoomPercent: 100, blockedAds: 0 };
}

const sources = (overrides: Partial<OmniboxSources> = {}): OmniboxSources => ({
  tabs: [],
  activeTabId: null,
  bookmarks: [],
  history: [],
  remote: [],
  engine: 'duckduckgo',
  engineName: 'DuckDuckGo',
  ...overrides
});

describe('omnibox suggestions', () => {
  it('puts a search for the typed text first, then search suggestions', () => {
    const result = buildOmniboxSuggestions('linear algebra', sources({ remote: ['linear algebra mit', 'linear algebra book'] }));
    expect(result[0]).toMatchObject({ kind: 'search', title: 'linear algebra', detail: 'Search DuckDuckGo', url: 'https://duckduckgo.com/?q=linear%20algebra' });
    expect(result.slice(1).map((entry) => entry.title)).toEqual(['linear algebra mit', 'linear algebra book']);
    expect(result[1]!.url).toBe('https://duckduckgo.com/?q=linear%20algebra%20mit');
  });

  it('offers to open addresses before searching for them', () => {
    const result = buildOmniboxSuggestions('github.com', sources({ engine: 'google', engineName: 'Google' }));
    expect(result[0]).toMatchObject({ kind: 'url', title: 'github.com', url: 'https://github.com/' });
    expect(result[1]).toMatchObject({ kind: 'search', url: 'https://www.google.com/search?q=github.com' });
  });

  it('includes other open tabs, bookmarks and history without duplicates', () => {
    const result = buildOmniboxSuggestions(
      'react',
      sources({
        tabs: [tab('a', 'React docs', 'https://react.dev/learn'), tab('b', 'Current', 'https://react.dev/current')],
        activeTabId: 'b',
        bookmarks: [{ id: '1', url: 'https://react.dev/reference', title: 'React reference', createdAt: 0 }],
        history: [
          { url: 'https://react.dev/reference', title: 'React reference', visits: 3, lastVisitedAt: 0 },
          { url: 'https://reactjs.org/', title: 'React old site', visits: 1, lastVisitedAt: 0 }
        ]
      })
    );
    expect(result.map((entry) => entry.kind)).toEqual(['search', 'tab', 'bookmark', 'history']);
    expect(result[1]).toMatchObject({ tabId: 'a', detail: 'Switch to this tab · react.dev/learn' });
    expect(result.filter((entry) => entry.url === 'https://react.dev/reference')).toHaveLength(1);
  });

  it('returns nothing for empty input and caps the list', () => {
    expect(buildOmniboxSuggestions('   ', sources())).toEqual([]);
    const many = Array.from({ length: 20 }, (_, index) => ({ url: `https://site${index}.test/`, title: `Site ${index}`, visits: 1, lastVisitedAt: 0 }));
    expect(buildOmniboxSuggestions('site', sources({ history: many, remote: ['a', 'b', 'c', 'd'] })).length).toBeLessThanOrEqual(8);
  });
});

describe('inline completion', () => {
  const known = ['https://www.youtube.com/watch?v=1', 'https://github.com/', 'https://docs.python.org/3/'];

  it('completes the host of a known site', () => {
    expect(inlineCompletion('you', known)).toBe('tube.com');
    expect(inlineCompletion('git', known)).toBe('hub.com');
    expect(inlineCompletion('docs.py', known)).toBe('thon.org');
  });

  it('never completes searches, full URLs or unknown text', () => {
    expect(inlineCompletion('you tube', known)).toBeNull();
    expect(inlineCompletion('https://you', known)).toBeNull();
    expect(inlineCompletion('zzz', known)).toBeNull();
    expect(inlineCompletion('', known)).toBeNull();
  });

  it('shows addresses the way people type them', () => {
    expect(typedForm('https://www.example.com/')).toBe('example.com');
    expect(typedForm('http://example.com/a/b')).toBe('example.com/a/b');
  });
});
