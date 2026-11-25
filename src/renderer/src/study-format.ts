import type { StudyEvent, StudySessionStats } from '../../shared/ipc.js';

/** Presentation helpers for Study Mode. No policy decisions live here. */

function formatSeconds(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(hours > 0 ? 2 : 1, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Time left in a timed session (rounds up, so 0:00 means done). */
export function formatCountdown(remainingMs: number): string {
  return formatSeconds(Math.max(0, Math.ceil(remainingMs / 1000)));
}

/** Time spent in an open-ended session (rounds down). */
export function formatElapsed(elapsedMs: number): string {
  return formatSeconds(Math.max(0, Math.floor(elapsedMs / 1000)));
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(Math.max(0, ms) / 60000);
  if (totalMinutes < 1) {
    return ms > 0 ? '<1m' : '0m';
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function topHosts(stats: StudySessionStats | null, limit = 5): Array<{ host: string; ms: number }> {
  if (!stats) {
    return [];
  }
  return Object.entries(stats.hostMs)
    .map(([host, ms]) => ({ host, ms }))
    .filter((entry) => entry.ms > 0)
    .sort((a, b) => b.ms - a.ms || a.host.localeCompare(b.host))
    .slice(0, limit);
}

export function focusRatio(stats: StudySessionStats | null): number | null {
  if (!stats) {
    return null;
  }
  const total = stats.focusedMs + stats.awayMs;
  return total > 0 ? stats.focusedMs / total : null;
}

export function describeStudyEvent(event: StudyEvent): string {
  switch (event.type) {
    case 'session-start':
      return `Session started${event.detail ? ` · ${event.detail}` : ''}`;
    case 'session-end':
      return event.detail === 'completed' ? 'Session completed' : 'Study Mode turned off';
    case 'visit':
      return `Visited ${event.host ?? 'page'}`;
    case 'blocked':
      return `Blocked ${event.host ?? 'page'}${event.detail ? ` · ${event.detail}` : ''}`;
    case 'focus-lost':
      return 'Left the browser';
    case 'focus-regained':
      return 'Came back to the browser';
    case 'classified':
      return `Checked ${event.host ?? 'page'}${event.detail ? ` · ${event.detail}` : ''}`;
  }
}

export function parseRuleText(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
