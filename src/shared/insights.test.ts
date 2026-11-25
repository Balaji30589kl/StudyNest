import { describe, expect, it } from 'vitest';
import type { StudySessionSummary } from './ipc.js';
import { computeInsights, localDayKey } from './insights.js';

const MIN = 60_000;

function session(id: string, start: Date, focusedMin: number, endReason: 'completed' | 'stopped' = 'completed', hostMs: Record<string, number> = {}): StudySessionSummary {
  const startedAt = start.getTime();
  return {
    id,
    startedAt,
    endsAt: startedAt + 25 * MIN,
    endedAt: startedAt + focusedMin * MIN,
    durationMinutes: 25,
    endReason,
    stats: { focusedMs: focusedMin * MIN, awayMs: 5 * MIN, focusLosses: 1, blockedCount: 2, blockedByList: 1, blockedByAi: 1, aiChecks: 2, aiAllowed: 1, pagesVisited: 3, hostMs, blockedHosts: { 'reddit.com': 1, 'youtube.com': 1 }, categoryCounts: { study: 1, entertainment: 1 } }
  };
}

describe('computeInsights', () => {
  const now = new Date(2026, 10, 12, 20, 0).getTime(); // 12 Nov 2026, 20:00 local

  it('handles no history', () => {
    const insights = computeInsights([], now);
    expect(insights.totals).toMatchObject({ sessions: 0, completionRate: null, averageSessionMs: null });
    expect(insights.daily).toHaveLength(14);
    expect(insights.daily.at(-1)?.date).toBe(localDayKey(now));
    expect(insights.currentStreakDays).toBe(0);
    expect(insights.bestHour).toBeNull();
  });

  it('aggregates totals, daily series, hosts, and best hour', () => {
    const sessions = [
      session('a', new Date(2026, 10, 12, 9, 0), 25, 'completed', { 'wikipedia.org': 10 * MIN }),
      session('b', new Date(2026, 10, 12, 14, 0), 10, 'stopped', { 'wikipedia.org': 2 * MIN, 'github.com': 5 * MIN }),
      session('c', new Date(2026, 10, 11, 9, 30), 25),
      session('old', new Date(2026, 8, 1, 9, 0), 25)
    ];
    const insights = computeInsights(sessions, now);

    expect(insights.totals).toMatchObject({ sessions: 4, completed: 3, completionRate: 0.75, focusedMs: 85 * MIN, blocked: 8, blockedByList: 4, blockedByAi: 4, aiChecks: 8, aiAllowed: 4 });
    expect(insights.categories).toEqual([{ category: 'entertainment', count: 4 }, { category: 'study', count: 4 }]);
    expect(insights.topBlockedHosts).toEqual([{ host: 'reddit.com', count: 4 }, { host: 'youtube.com', count: 4 }]);
    expect(insights.totals.averageSessionMs).toBe((85 / 4) * MIN);
    expect(insights.focusRatio).toBeCloseTo(85 / 105);
    expect(insights.daily.at(-1)).toEqual({ date: '2026-11-12', focusedMs: 35 * MIN, sessions: 2, blocked: 4 });
    expect(insights.daily.at(-2)).toEqual({ date: '2026-11-11', focusedMs: 25 * MIN, sessions: 1, blocked: 2 });
    expect(insights.topHosts).toEqual([
      { host: 'wikipedia.org', ms: 12 * MIN },
      { host: 'github.com', ms: 5 * MIN }
    ]);
    expect(insights.bestHour).toBe(9);
  });

  it('computes current and longest streaks from completed sessions only', () => {
    const sessions = [
      // Current streak: 10, 11 Nov (today 12 Nov has no session yet, so it counts from yesterday).
      session('d1', new Date(2026, 10, 10, 9), 25),
      session('d2', new Date(2026, 10, 11, 9), 25),
      session('stopped-today', new Date(2026, 10, 12, 9), 5, 'stopped'),
      // Longer earlier streak: 1-4 Nov.
      session('e1', new Date(2026, 10, 1, 9), 25),
      session('e2', new Date(2026, 10, 2, 9), 25),
      session('e3', new Date(2026, 10, 3, 9), 25),
      session('e4', new Date(2026, 10, 4, 9), 25)
    ];
    const insights = computeInsights(sessions, now);
    expect(insights.currentStreakDays).toBe(2);
    expect(insights.longestStreakDays).toBe(4);
  });

  it('breaks the current streak after a missed day', () => {
    const insights = computeInsights([session('x', new Date(2026, 10, 10, 9), 25)], now);
    expect(insights.currentStreakDays).toBe(0);
    expect(insights.longestStreakDays).toBe(1);
  });
});
