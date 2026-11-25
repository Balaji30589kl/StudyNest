import { describe, expect, it, vi } from 'vitest';
import type { Classification } from '../../shared/classification.js';
import { DEFAULT_CLASSIFICATION_POLICY, StudyPolicy } from '../../shared/study-policy.js';
import { parseInterstitial } from '../navigation-guard.js';
import { StudyModeService } from './study-mode-service.js';
import { createEmptyStudyData, MemoryStudyStore } from './study-store.js';

const POLICY: StudyPolicy = {
  block: ['reddit.com', 'youtube.com/shorts'],
  allow: ['wikipedia.org'],
  classification: { ...DEFAULT_CLASSIFICATION_POLICY, perPageHosts: ['youtube.com'] }
};

function verdict(category: Classification['category'], key: string): Classification {
  return { category, confidence: 0.9, rationale: '', host: 'youtube.com', key, providerId: 'gateway', fallback: false, classifiedAt: 0 };
}

function createHarness(options: { store?: MemoryStudyStore; start?: number; verdicts?: Record<string, Classification['category']> } = {}) {
  let now = options.start ?? 1_000_000;
  let idCounter = 0;
  const timers: Array<{ callback: () => void; at: number; cancelled: boolean }> = [];
  const notify = vi.fn();
  const store = options.store ?? new MemoryStudyStore();
  const cache = new Map<string, Classification>();
  const keyOf = (url: string) => {
    const parsed = new URL(url);
    return parsed.hostname.endsWith('youtube.com') ? `youtube.com/watch?v=${parsed.searchParams.get('v')}` : parsed.hostname.replace(/^www\./, '');
  };
  const classify = vi.fn(async (url: string) => {
    // Like the real client, the answer is cached only after an asynchronous lookup.
    await Promise.resolve();
    const key = keyOf(url);
    const result = verdict(options.verdicts?.[key] ?? 'study', key);
    cache.set(key, result);
    return result;
  });

  const service = new StudyModeService({
    store,
    getPolicy: () => POLICY,
    classificationLookup: (url) => cache.get(keyOf(url)) ?? null,
    classify,
    now: () => now,
    createId: () => `id-${++idCounter}`,
    scheduleTimeout: (callback, delayMs) => {
      const timer = { callback, at: now + delayMs, cancelled: false };
      timers.push(timer);
      return timer;
    },
    cancelTimeout: (handle) => {
      (handle as { cancelled: boolean }).cancelled = true;
    },
    notify
  });

  return {
    service,
    store,
    notify,
    classify,
    advance(ms: number) {
      now += ms;
      for (const timer of timers) {
        if (!timer.cancelled && timer.at <= now) {
          timer.cancelled = true;
          timer.callback();
        }
      }
    }
  };
}

describe('StudyModeService', () => {
  it('allows everything while Study Mode is off', () => {
    const { service } = createHarness();
    expect(service.evaluateNavigation('https://reddit.com')).toEqual({ kind: 'allow' });
  });

  it('blocks block-listed pages before they load and records why', () => {
    const { service } = createHarness();
    service.startSession(null);
    const decision = service.evaluateNavigation('https://www.youtube.com/shorts/abc');
    if (decision.kind !== 'intercept') throw new Error('expected intercept');
    expect(decision.blocked).toMatchObject({ host: 'youtube.com', action: 'block', reason: 'blocklisted' });
    expect(parseInterstitial(decision.interstitialUrl)).toEqual({ target: 'https://www.youtube.com/shorts/abc', kind: 'blocked' });

    const stats = service.getSnapshot().stats!;
    expect(stats).toMatchObject({ blockedCount: 1, blockedByList: 1, blockedByAi: 0, blockedHosts: { 'youtube.com': 1 } });
    expect(service.getSnapshot().recentEvents[0]).toMatchObject({ type: 'blocked', detail: 'List: youtube.com/shorts' });
  });

  it('allows allow-listed pages without a check', () => {
    const { service, classify } = createHarness();
    service.startSession(null);
    expect(service.evaluateNavigation('https://en.wikipedia.org/wiki/Tree')).toEqual({ kind: 'allow' });
    expect(classify).not.toHaveBeenCalled();
  });

  it('defers unlisted pages until the AI verdict is in, then decides per video', async () => {
    const { service, classify } = createHarness({ verdicts: { 'youtube.com/watch?v=lecture': 'study', 'youtube.com/watch?v=prank': 'entertainment' } });
    service.startSession(25);

    const first = service.evaluateNavigation('https://www.youtube.com/watch?v=lecture');
    if (first.kind !== 'defer') throw new Error('expected defer');
    expect(parseInterstitial(first.checkingUrl)?.kind).toBe('checking');
    await first.ready;
    expect(service.evaluateNavigation('https://www.youtube.com/watch?v=lecture')).toEqual({ kind: 'allow' });

    const second = service.evaluateNavigation('https://www.youtube.com/watch?v=prank');
    if (second.kind !== 'defer') throw new Error('expected defer');
    await second.ready;
    const blocked = service.evaluateNavigation('https://www.youtube.com/watch?v=prank');
    if (blocked.kind !== 'intercept') throw new Error('expected intercept');
    expect(blocked.blocked).toMatchObject({ reason: 'classified', classification: { category: 'entertainment' } });

    expect(classify).toHaveBeenCalledTimes(2);
    const stats = service.getSnapshot().stats!;
    expect(stats).toMatchObject({ aiChecks: 2, aiAllowed: 1, blockedByAi: 1, categoryCounts: { study: 1, entertainment: 1 } });
    expect(service.getSnapshot().recentEvents.some((event) => event.type === 'classified' && event.detail?.includes('entertainment'))).toBe(true);
  });

  it('checks each page once even when several tabs ask at the same time', async () => {
    const { service, classify } = createHarness();
    service.startSession(null);
    const a = service.evaluateNavigation('https://www.youtube.com/watch?v=x');
    const b = service.evaluateNavigation('https://www.youtube.com/watch?v=x');
    if (a.kind !== 'defer' || b.kind !== 'defer') throw new Error('expected defer');
    await Promise.all([a.ready, b.ready]);
    expect(classify).toHaveBeenCalledTimes(1);
    expect(service.getSnapshot().stats!.aiChecks).toBe(1);
  });

  it('does not reject when classification fails', async () => {
    const harness = createHarness();
    harness.classify.mockRejectedValueOnce(new Error('offline'));
    harness.service.startSession(null);
    const decision = harness.service.evaluateNavigation('https://www.youtube.com/watch?v=y');
    if (decision.kind !== 'defer') throw new Error('expected defer');
    await expect(decision.ready).resolves.toBeUndefined();
  });

  it('supports open-ended Study Mode with no timer', () => {
    const { service, advance } = createHarness();
    service.startSession(null);
    expect(service.getSnapshot().session).toMatchObject({ endsAt: null, durationMinutes: null });
    advance(3 * 60 * 60_000);
    expect(service.isSessionActive()).toBe(true);
    expect(service.getSnapshot().stats!.focusedMs).toBe(3 * 60 * 60_000);
    service.stopSession();
    expect(service.getSnapshot().recentSessions[0]).toMatchObject({ endReason: 'stopped', durationMinutes: null });
  });

  it('completes timed sessions on the timer and notifies', () => {
    const { service, advance, notify } = createHarness();
    service.startSession(25);
    advance(25 * 60_000);
    expect(service.getSnapshot().session).toBeNull();
    expect(service.getSnapshot().recentSessions[0]).toMatchObject({ endReason: 'completed', durationMinutes: 25 });
    expect(notify).toHaveBeenCalledWith('Focus session complete', expect.stringContaining('25 min focused'));
  });

  it('tracks focused, away, and per-host time', () => {
    const { service, advance } = createHarness();
    service.startSession(60);
    service.onPageCommitted({ tabId: 't', url: 'https://en.wikipedia.org/wiki/Tree', title: 'Tree', isActiveTab: true });
    advance(10 * 60_000);
    service.setWindowFocused(false);
    advance(5 * 60_000);
    service.setWindowFocused(true);
    const stats = service.getSnapshot().stats!;
    expect(stats.focusedMs).toBe(10 * 60_000);
    expect(stats.awayMs).toBe(5 * 60_000);
    expect(stats.focusLosses).toBe(1);
    expect(stats.hostMs).toEqual({ 'en.wikipedia.org': 10 * 60_000 });
  });

  it('re-checks open tabs when the backend rules change', () => {
    const { service } = createHarness();
    const listener = vi.fn();
    service.onChange(listener);
    service.policyChanged();
    expect(listener).toHaveBeenCalledWith('policy');
  });

  it('only stores the session length preference as a user setting', () => {
    const { service } = createHarness();
    expect(service.updateSettings({ defaultDurationMinutes: 50, blocklist: ['x.com'] }).settings).toEqual({ defaultDurationMinutes: 50 });
  });

  it('resumes an open-ended session after a restart', () => {
    const first = createHarness();
    first.service.startSession(null);
    first.service.evaluateNavigation('https://reddit.com');
    const resumed = createHarness({ store: first.store, start: 1_000_000 + 60 * 60_000 });
    const snapshot = resumed.service.getSnapshot();
    expect(snapshot.session?.endsAt).toBeNull();
    expect(snapshot.stats?.blockedCount).toBe(1);
  });

  it('closes a timed session that expired while the app was closed', () => {
    const first = createHarness();
    first.service.startSession(25);
    const resumed = createHarness({ store: first.store, start: 1_000_000 + 60 * 60_000 });
    expect(resumed.service.getSnapshot().session).toBeNull();
    expect(resumed.service.getSnapshot().recentSessions[0]?.endReason).toBe('completed');
  });

  it('fills in new stats fields for sessions saved by older versions', () => {
    const data = createEmptyStudyData();
    data.sessions.push({
      id: 'old',
      startedAt: 1,
      endsAt: 2,
      endedAt: 2,
      durationMinutes: 25,
      endReason: 'completed',
      stats: { focusedMs: 5, awayMs: 0, focusLosses: 0, blockedCount: 1, pagesVisited: 0, hostMs: {} } as never
    });
    const { service } = createHarness({ store: new MemoryStudyStore(data) });
    expect(service.getSessionHistory()[0]!.stats).toMatchObject({ blockedByAi: 0, aiChecks: 0, categoryCounts: {}, blockedHosts: {} });
  });
});
