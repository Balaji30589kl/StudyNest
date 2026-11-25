import { describe, expect, it } from 'vitest';
import { BrowserTabState } from '../../shared/ipc.js';
import { buildOmniboxSuggestions, createRecentEntryList, toSearchSubmissionValue } from './omnibox.js';

const tabs: BrowserTabState[] = [
  {
    id: 'tab-1',
    title: 'YouTube',
    url: 'https://www.youtube.com/',
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
    blocked: null,
    checking: false
  },
  {
    id: 'tab-2',
    title: 'LeetCode',
    url: 'https://leetcode.com/',
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
    blocked: null,
    checking: false
  }
];

describe('omnibox helpers', () => {
  it('prioritizes the search action for bare words', () => {
    const suggestions = buildOmniboxSuggestions('youtube', tabs, ['leetcode'], []);

    expect(suggestions[0]?.kind).toBe('search');
    expect(suggestions[0]?.value).toBe('youtube');
  });

  it('offers a go-to-url action for domains', () => {
    const suggestions = buildOmniboxSuggestions('example.com', tabs, [], []);

    expect(suggestions[0]?.kind).toBe('url');
    expect(suggestions[0]?.value).toBe('https://example.com/');
  });

  it('keeps recent entries deduplicated and newest first', () => {
    expect(createRecentEntryList(['leetcode', 'youtube'], 'youtube')).toEqual(['youtube', 'leetcode']);
  });

  it('submits search suggestions as the raw query', () => {
    const suggestions = buildOmniboxSuggestions('youtube', tabs, [], []);

    expect(toSearchSubmissionValue(suggestions[0]!)).toBe('youtube');
  });
});
