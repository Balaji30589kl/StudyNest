import type { PageCategory } from './classification.js';
import type { StudySessionSummary } from './ipc.js';

/** A day counts toward a streak with a completed timed session or this much focus. */
export const STREAK_MIN_FOCUS_MS = 10 * 60 * 1000;

/**
 * Phase 4 focus analytics. Pure aggregation over finished session summaries:
 * no I/O and no browser control, so dashboards stay decoupled from the shell.
 */

export type DailyFocus = {
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  focusedMs: number;
  sessions: number;
  blocked: number;
};

export type InsightsSnapshot = {
  generatedAt: number;
  totals: {
    sessions: number;
    completed: number;
    completionRate: number | null;
    focusedMs: number;
    awayMs: number;
    blocked: number;
    blockedByList: number;
    blockedByAi: number;
    aiChecks: number;
    aiAllowed: number;
    pagesVisited: number;
    averageSessionMs: number | null;
  };
  /** AI verdicts per category, most frequent first. */
  categories: Array<{ category: PageCategory; count: number }>;
  topBlockedHosts: Array<{ host: string; count: number }>;
  focusRatio: number | null;
  currentStreakDays: number;
  longestStreakDays: number;
  daily: DailyFocus[];
  topHosts: Array<{ host: string; ms: number }>;
  /** Local hour (0-23) whose sessions produced the most focused time. */
  bestHour: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function localDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Steps back one local calendar day (DST-safe). */
function previousDay(dayStart: number): number {
  return startOfLocalDay(dayStart - DAY_MS / 2);
}

function streaks(completedDays: Set<string>, now: number): { current: number; longest: number } {
  // Current streak: consecutive days ending today, or yesterday if today has no session yet.
  let cursor = startOfLocalDay(now);
  if (!completedDays.has(localDayKey(cursor))) {
    cursor = previousDay(cursor);
  }
  let current = 0;
  while (completedDays.has(localDayKey(cursor))) {
    current += 1;
    cursor = previousDay(cursor);
  }

  const sorted = [...completedDays].sort();
  let longest = 0;
  let run = 0;
  let previous: string | null = null;
  for (const day of sorted) {
    const expected = previous ? localDayKey(startOfLocalDay(new Date(`${previous}T12:00:00`).getTime() + DAY_MS)) : null;
    run = previous && day === expected ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = day;
  }

  return { current, longest: Math.max(longest, current) };
}

export function computeInsights(sessions: readonly StudySessionSummary[], now: number, days = 14): InsightsSnapshot {
  const completed = sessions.filter((session) => session.endReason === 'completed');
  const timed = sessions.filter((session) => session.durationMinutes !== null);
  const focusedMs = sessions.reduce((sum, session) => sum + session.stats.focusedMs, 0);
  const awayMs = sessions.reduce((sum, session) => sum + session.stats.awayMs, 0);

  const dailyMap = new Map<string, DailyFocus>();
  let cursor = startOfLocalDay(now);
  const keys: string[] = [];
  for (let index = 0; index < days; index += 1) {
    keys.unshift(localDayKey(cursor));
    cursor = previousDay(cursor);
  }
  for (const key of keys) {
    dailyMap.set(key, { date: key, focusedMs: 0, sessions: 0, blocked: 0 });
  }

  const hostTotals = new Map<string, number>();
  const blockedHostTotals = new Map<string, number>();
  const categoryTotals = new Map<PageCategory, number>();
  const hourTotals = new Map<number, number>();
  for (const session of sessions) {
    const bucket = dailyMap.get(localDayKey(session.startedAt));
    if (bucket) {
      bucket.focusedMs += session.stats.focusedMs;
      bucket.sessions += 1;
      bucket.blocked += session.stats.blockedCount ?? 0;
    }
    for (const [host, ms] of Object.entries(session.stats.hostMs ?? {})) {
      hostTotals.set(host, (hostTotals.get(host) ?? 0) + ms);
    }
    for (const [host, count] of Object.entries(session.stats.blockedHosts ?? {})) {
      blockedHostTotals.set(host, (blockedHostTotals.get(host) ?? 0) + count);
    }
    for (const [category, count] of Object.entries(session.stats.categoryCounts ?? {})) {
      categoryTotals.set(category as PageCategory, (categoryTotals.get(category as PageCategory) ?? 0) + (count ?? 0));
    }
    const hour = new Date(session.startedAt).getHours();
    hourTotals.set(hour, (hourTotals.get(hour) ?? 0) + session.stats.focusedMs);
  }

  let bestHour: number | null = null;
  let bestHourMs = 0;
  for (const [hour, ms] of hourTotals) {
    if (ms > bestHourMs || (ms === bestHourMs && bestHour !== null && hour < bestHour)) {
      bestHour = hour;
      bestHourMs = ms;
    }
  }

  const productiveDays = sessions
    .filter((session) => session.endReason === 'completed' || session.stats.focusedMs >= STREAK_MIN_FOCUS_MS)
    .map((session) => localDayKey(session.startedAt));
  const { current, longest } = streaks(new Set(productiveDays), now);
  const sum = (pick: (session: StudySessionSummary) => number | undefined) => sessions.reduce((total, session) => total + (pick(session) ?? 0), 0);

  return {
    generatedAt: now,
    totals: {
      sessions: sessions.length,
      completed: completed.length,
      // Open-ended sessions are switched off, not completed, so only timed ones count here.
      completionRate: timed.length > 0 ? timed.filter((session) => session.endReason === 'completed').length / timed.length : null,
      focusedMs,
      awayMs,
      blocked: sum((session) => session.stats.blockedCount),
      blockedByList: sum((session) => session.stats.blockedByList),
      blockedByAi: sum((session) => session.stats.blockedByAi),
      aiChecks: sum((session) => session.stats.aiChecks),
      aiAllowed: sum((session) => session.stats.aiAllowed),
      pagesVisited: sum((session) => session.stats.pagesVisited),
      averageSessionMs: sessions.length > 0 ? focusedMs / sessions.length : null
    },
    categories: [...categoryTotals.entries()]
      .map(([category, count]) => ({ category, count }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category)),
    topBlockedHosts: [...blockedHostTotals.entries()]
      .map(([host, count]) => ({ host, count }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count || a.host.localeCompare(b.host))
      .slice(0, 8),
    focusRatio: focusedMs + awayMs > 0 ? focusedMs / (focusedMs + awayMs) : null,
    currentStreakDays: current,
    longestStreakDays: longest,
    daily: keys.map((key) => dailyMap.get(key)!),
    topHosts: [...hostTotals.entries()]
      .map(([host, ms]) => ({ host, ms }))
      .filter((entry) => entry.ms > 0)
      .sort((a, b) => b.ms - a.ms || a.host.localeCompare(b.host))
      .slice(0, 8),
    bestHour: bestHourMs > 0 ? bestHour : null
  };
}
