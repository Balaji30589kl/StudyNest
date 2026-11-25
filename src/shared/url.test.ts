import { describe, expect, it } from 'vitest';
import { buildSearchUrl, classifyNavigationInput, displayUrl, isSafeNavigationUrl, normalizeNavigationInput } from './url.js';
import { LANDING_PAGE_URL } from './landing-page.js';

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

  it('rejects unsafe protocols', () => {
    expect(isSafeNavigationUrl('javascript:alert(1)')).toBe(false);
  });

  it('shows a readable label for blank tabs', () => {
    expect(displayUrl('about:blank')).toBe('New tab');
  });

  it('shows a readable label for the StudyNest landing page', () => {
    expect(displayUrl(LANDING_PAGE_URL)).toBe('StudyNest Start');
  });

  it('shows the search query instead of the raw search url', () => {
    expect(displayUrl(buildSearchUrl('youtube'))).toBe('youtube');
  });

  it('falls back to search for plain text input', () => {
    expect(normalizeNavigationInput('machine learning basics')).toContain('duckduckgo.com/?q=machine%20learning%20basics');
  });
});