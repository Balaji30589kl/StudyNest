import { describe, expect, it } from 'vitest';
import { describeStudyEvent, focusRatio, formatCountdown, formatDuration, parseRuleText, topHosts } from './study-format.js';

const stats = {
  focusedMs: 30 * 60_000,
  awayMs: 10 * 60_000,
  focusLosses: 2,
  blockedCount: 3,
  blockedByList: 2,
  blockedByAi: 1,
  aiChecks: 3,
  aiAllowed: 2,
  blockedHosts: {},
  categoryCounts: {},
  pagesVisited: 5,
  hostMs: { 'a.com': 1000, 'b.com': 5000, 'c.com': 0 }
};

describe('study formatting', () => {
  it('formats countdowns', () => {
    expect(formatCountdown(25 * 60_000)).toBe('25:00');
    expect(formatCountdown(61_500)).toBe('1:02');
    expect(formatCountdown(90 * 60_000)).toBe('1:30:00');
    expect(formatCountdown(-5)).toBe('0:00');
  });

  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(30_000)).toBe('<1m');
    expect(formatDuration(75 * 60_000)).toBe('1h 15m');
  });

  it('ranks top hosts and computes focus ratio', () => {
    expect(topHosts(stats)).toEqual([
      { host: 'b.com', ms: 5000 },
      { host: 'a.com', ms: 1000 }
    ]);
    expect(focusRatio(stats)).toBe(0.75);
    expect(focusRatio(null)).toBeNull();
  });

  it('describes events and parses rule text', () => {
    expect(describeStudyEvent({ id: '1', type: 'blocked', at: 0, sessionId: null, host: 'x.com' })).toBe('Blocked x.com');
    expect(parseRuleText('a.com\n\n b.com , c.com')).toEqual(['a.com', 'b.com', 'c.com']);
  });
});
