import { describe, expect, it } from 'vitest';
import { NEW_TAB_URL } from './internal-pages.js';
import { buildSearchUrl, classifyNavigationInput, displayUrl, extractSearchQueryFromUrl, hostLabel, isSafeNavigationUrl, normalizeNavigationInput } from './url.js';

describe('navigation url helpers', () => {
  it('adds https to bare hostnames', () => {
    expect(normalizeNavigationInput('example.com')).toBe('https://example.com/');
  });

  it('keeps valid http urls intact', () => {
    expect(normalizeNavigationInput('https://docs.example.com/path')).toBe('https://docs.example.com/path');
  });

  it('treats bare words as searches', () => {
    expect(classifyNavigationInput('youtube')).toBe('search');
    expect(normalizeNavigationInput('youtube')).toBe(buildSearchUrl('youtube'));
  });

  it('searches with the chosen engine', () => {
    expect(normalizeNavigationInput('machine learning basics')).toContain('duckduckgo.com/?q=machine%20learning%20basics');
    expect(normalizeNavigationInput('machine learning', 'google')).toBe('https://www.google.com/search?q=machine%20learning');
    expect(normalizeNavigationInput('cats', 'bing')).toBe('https://www.bing.com/search?q=cats');
  });

  it('recognises results pages of every engine', () => {
    expect(extractSearchQueryFromUrl('https://www.google.com/search?q=linear+algebra&hl=en')).toBe('linear algebra');
    expect(extractSearchQueryFromUrl('https://duckduckgo.com/?q=youtube')).toBe('youtube');
    expect(extractSearchQueryFromUrl('https://search.brave.com/search?q=x')).toBe('x');
    expect(extractSearchQueryFromUrl('https://www.google.com/maps?q=x')).toBeNull();
  });

  it('keeps internal pages and opens a new tab page for empty input', () => {
    expect(normalizeNavigationInput('studynest://history')).toBe('studynest://history');
    expect(normalizeNavigationInput('StudyNest://Settings#privacy')).toBe('studynest://Settings#privacy');
    expect(classifyNavigationInput('studynest://bookmarks')).toBe('url');
    expect(normalizeNavigationInput('  ')).toBe(NEW_TAB_URL);
    expect(isSafeNavigationUrl('studynest://settings')).toBe(true);
  });

  it('rejects unsafe protocols', () => {
    expect(isSafeNavigationUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeNavigationUrl('file:///C:/Windows')).toBe(false);
  });

  it('shows an empty address bar on new tabs and the bare address for internal pages', () => {
    expect(displayUrl('about:blank')).toBe('');
    expect(displayUrl(NEW_TAB_URL)).toBe('');
    expect(displayUrl('studynest://settings#privacy')).toBe('studynest://settings');
    expect(displayUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
  });

  it('labels hosts without www', () => {
    expect(hostLabel('https://www.youtube.com/watch?v=1')).toBe('youtube.com');
    expect(hostLabel('studynest://history')).toBe('studynest://history');
  });
});
