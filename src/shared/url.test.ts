import { describe, expect, it } from 'vitest';
import { displayUrl, isSafeNavigationUrl, normalizeNavigationInput } from './url.js';

describe('navigation url helpers', () => {
  it('adds https to bare hostnames', () => {
    expect(normalizeNavigationInput('example.com')).toBe('https://example.com/');
  });

  it('keeps valid http urls intact', () => {
    expect(normalizeNavigationInput('https://docs.example.com/path')).toBe('https://docs.example.com/path');
  });

  it('rejects unsafe protocols', () => {
    expect(isSafeNavigationUrl('javascript:alert(1)')).toBe(false);
  });

  it('shows a readable label for blank tabs', () => {
    expect(displayUrl('about:blank')).toBe('New tab');
  });

  it('falls back to search for plain text input', () => {
    expect(normalizeNavigationInput('machine learning basics')).toContain('duckduckgo.com/?q=machine%20learning%20basics');
  });
});