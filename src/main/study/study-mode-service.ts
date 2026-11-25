import { randomUUID } from 'node:crypto';
import type {
  BlockedNavigationInfo,
  PolicySnapshot,
  StudyEvent,
  StudyEventType,
  StudySessionState,
  StudySessionStats,
  StudySessionSummary,
  StudyStateSnapshot
} from '../../shared/ipc.js';
import type { Classification } from '../../shared/classification.js';
import {
  clampSessionMinutes,
  classificationKey,
  evaluateStudyPolicy,
  getPolicyHost,
  PolicyContext,
  sanitizeStudySettings,
  StudyPolicy,
  StudySettings
} from '../../shared/study-policy.js';
import type { CommittedPage, GuardDecision, NavigationGuard } from '../navigation-guard.js';
import { buildCheckingUrl, buildInterstitialUrl } from './interstitial-page.js';
import { MAX_STORED_EVENTS, MAX_STORED_SESSIONS, PersistedStudyData, StudyStore } from './study-store.js';

/** 'policy' changes can alter which pages are allowed; 'state' changes cannot. */
export type StudyChangeKind = 'state' | 'policy';
type StudyChangeListener = (kind: StudyChangeKind) => void;

export type StudyModeServiceDeps = {
  store: StudyStore;
  /** Current backend rules (block list, allow list, classification config). */
  getPolicy: () => StudyPolicy;
  getPolicySnapshot?: () => PolicySnapshot;
  /** Synchronous lookup of a cached prediction for a URL. */
  classificationLookup?: (url: string) => Classification | null;
  /** Classifies a page before it renders (fetch metadata, ask the gateway, fall back offline). */
  classify?: (url: string) => Promise<Classification>;
  now?: () => number;
  createId?: () => string;
  scheduleTimeout?: (callback: () => void, delayMs: number) => unknown;
  cancelTimeout?: (handle: unknown) => void;
  notify?: (title: string, body: string) => void;
};

const SNAPSHOT_EVENT_LIMIT = 40;
const SNAPSHOT_SESSION_LIMIT = 10;

const EMPTY_POLICY_SNAPSHOT: PolicySnapshot = {
  source: 'built-in',
  version: null,
  updatedAt: null,
  blockRules: 0,
  allowRules: 0,
  aiEnabled: true,
  lastError: null
};

export function createEmptyStats(): StudySessionStats {
  return {
    focusedMs: 0,
    awayMs: 0,
    focusLosses: 0,
    blockedCount: 0,
    blockedByList: 0,
    blockedByAi: 0,
    aiChecks: 0,
    aiAllowed: 0,
    pagesVisited: 0,
    hostMs: {},
    blockedHosts: {},
    categoryCounts: {}
  };
}

/** Fills in fields added after a session was stored or synced. */
export function normalizeStats(stats: Partial<StudySessionStats>): StudySessionStats {
  const empty = createEmptyStats();
  return {
    ...empty,
    ...stats,
    hostMs: { ...(stats.hostMs ?? {}) },
    blockedHosts: { ...(stats.blockedHosts ?? {}) },
    categoryCounts: { ...(stats.categoryCounts ?? {}) }
  };
}

function formatMinutes(ms: number): string {
  return `${Math.round(ms / 60000)} min`;
}

/**
 * Owns Study Mode: the on/off state and timed sessions, enforcement of the
 * backend rules (block list, allow list, AI verdicts before rendering), focus
 * tracking, and the study history. No Electron dependency, so it is unit tested.
 */
export class StudyModeService implements NavigationGuard {
  private readonly store: StudyStore;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly scheduleTimeout: (callback: () => void, delayMs: number) => unknown;
  private readonly cancelTimeout: (handle: unknown) => void;
  private readonly notify: (title: string, body: string) => void;
  private readonly classificationLookup: (url: string) => Classification | null;
  private readonly classifyPage: ((url: string) => Promise<Classification>) | null;

  private settings: StudySettings;
  private settingsUpdatedAt: number;
  private events: StudyEvent[];
  private sessions: StudySessionSummary[];
  private session: StudySessionState | null = null;
  private stats: StudySessionStats | null = null;
  private readonly pendingChecks = new Map<string, Promise<void>>();
  private readonly listeners = new Set<StudyChangeListener>();
  private windowFocused = true;
  private activeHost: string | null = null;
  private lastTick = 0;
  private endTimer: unknown = null;

  constructor(private readonly deps: StudyModeServiceDeps) {
    this.store = deps.store;
    this.now = deps.now ?? Date.now;
    this.createId = deps.createId ?? randomUUID;
    this.scheduleTimeout = deps.scheduleTimeout ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancelTimeout = deps.cancelTimeout ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.notify = deps.notify ?? (() => undefined);
    this.classificationLookup = deps.classificationLookup ?? (() => null);
    this.classifyPage = deps.classify ?? null;

    const data = this.store.load();
    this.settings = data.settings;
    this.settingsUpdatedAt = data.settingsUpdatedAt;
    this.events = data.events;
    this.sessions = data.sessions.map((session) => ({ ...session, stats: normalizeStats(session.stats) }));
    this.stats = this.sessions.at(-1)?.stats ?? null;
    this.restoreActiveSession(data);
  }

  onChange(listener: StudyChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  isSessionActive(): boolean {
    return this.session !== null;
  }

  getSettings(): StudySettings {
    return { ...this.settings };
  }

  getSessionHistory(): StudySessionSummary[] {
    return this.sessions.map((session) => ({ ...session, stats: normalizeStats(session.stats) }));
  }

  getSnapshot(): StudyStateSnapshot {
    this.tick();
    return {
      settings: this.getSettings(),
      policy: this.deps.getPolicySnapshot?.() ?? EMPTY_POLICY_SNAPSHOT,
      session: this.session ? { ...this.session } : null,
      stats: this.stats ? normalizeStats(this.stats) : null,
      recentEvents: this.events.slice(-SNAPSHOT_EVENT_LIMIT).reverse(),
      recentSessions: this.sessions.slice(-SNAPSHOT_SESSION_LIMIT).reverse()
    };
  }

  /**
   * Turns Study Mode on. Pass minutes for a timed session, null for an
   * open-ended one (on until switched off), or nothing for the default length.
   */
  startSession(durationMinutes?: number | null): StudyStateSnapshot {
    if (this.session) {
      return this.getSnapshot();
    }

    const minutes =
      durationMinutes === null ? null : clampSessionMinutes(durationMinutes ?? this.settings.defaultDurationMinutes, this.settings.defaultDurationMinutes);
    const startedAt = this.now();
    this.session = {
      id: this.createId(),
      startedAt,
      endsAt: minutes === null ? null : startedAt + minutes * 60_000,
      durationMinutes: minutes
    };
    this.stats = createEmptyStats();
    this.pendingChecks.clear();
    this.lastTick = startedAt;
    this.logEvent('session-start', { detail: minutes === null ? 'Study Mode on' : `${minutes} minute session` });
    this.scheduleSessionEnd();
    this.commit('policy');
    return this.getSnapshot();
  }

  stopSession(endReason: StudySessionSummary['endReason'] = 'stopped'): StudyStateSnapshot {
    const session = this.session;
    const stats = this.stats;
    if (!session || !stats) {
      return this.getSnapshot();
    }

    this.tick();
    const endedAt = session.endsAt === null ? this.now() : Math.min(this.now(), session.endsAt);
    this.sessions.push({ ...session, endedAt, endReason, stats: normalizeStats(stats) });
    if (this.sessions.length > MAX_STORED_SESSIONS) {
      this.sessions.splice(0, this.sessions.length - MAX_STORED_SESSIONS);
    }
    this.logEvent('session-end', { detail: endReason });
    this.session = null;
    this.pendingChecks.clear();
    this.clearEndTimer();
    this.commit('policy');

    if (endReason === 'completed') {
      this.notify(
        'Focus session complete',
        `${formatMinutes(stats.focusedMs)} focused · ${stats.blockedCount} distraction${stats.blockedCount === 1 ? '' : 's'} blocked`
      );
    }

    return this.getSnapshot();
  }

  updateSettings(partial: unknown): StudyStateSnapshot {
    this.settings = sanitizeStudySettings(partial, this.settings);
    this.settingsUpdatedAt = this.now();
    this.commit('state');
    return this.getSnapshot();
  }

  /** Called when the backend rules change: open tabs must be re-checked. */
  policyChanged(): void {
    this.commit('policy');
  }

  // Sync participant -------------------------------------------------------------

  getSyncState(): { settings: StudySettings; settingsUpdatedAt: number; sessions: StudySessionSummary[] } {
    return { settings: this.getSettings(), settingsUpdatedAt: this.settingsUpdatedAt, sessions: this.getSessionHistory() };
  }

  applySyncedData(data: { settings: { value: StudySettings; updatedAt: number } | null; sessions: StudySessionSummary[] }): void {
    if (data.settings) {
      this.settings = sanitizeStudySettings(data.settings.value, this.settings);
      this.settingsUpdatedAt = data.settings.updatedAt;
    }
    if (data.sessions.length > 0) {
      const known = new Set(this.sessions.map((session) => session.id));
      const incoming = data.sessions
        .filter((session) => !known.has(session.id))
        .map((session) => ({ ...session, stats: normalizeStats(session.stats) }));
      this.sessions = [...this.sessions, ...incoming].sort((a, b) => a.startedAt - b.startedAt).slice(-MAX_STORED_SESSIONS);
    }
    this.commit('state');
  }

  clearHistory(): StudyStateSnapshot {
    this.events = [];
    this.sessions = [];
    if (!this.session) {
      this.stats = null;
    }
    this.commit('state');
    return this.getSnapshot();
  }

  setWindowFocused(focused: boolean): void {
    if (focused === this.windowFocused) {
      return;
    }
    this.tick();
    this.windowFocused = focused;
    if (this.session && this.stats) {
      if (!focused) {
        this.stats.focusLosses += 1;
      }
      this.logEvent(focused ? 'focus-regained' : 'focus-lost');
      this.commit('state');
    }
  }

  // NavigationGuard -----------------------------------------------------------

  evaluateNavigation(url: string): GuardDecision {
    const decision = evaluateStudyPolicy(url, this.policyContext(url));

    if (decision.action === 'allow' || decision.host === null) {
      return { kind: 'allow' };
    }

    if (decision.action === 'check') {
      return { kind: 'defer', checkingUrl: buildCheckingUrl(url, decision.host), ready: this.checkPage(url) };
    }

    const byAi = decision.reason === 'classified';
    if (this.stats) {
      this.stats.blockedCount += 1;
      if (byAi) this.stats.blockedByAi += 1;
      else this.stats.blockedByList += 1;
      this.stats.blockedHosts[decision.host] = (this.stats.blockedHosts[decision.host] ?? 0) + 1;
    }
    this.logEvent('blocked', {
      host: decision.host,
      url,
      detail: byAi && decision.classification ? `AI: ${decision.classification.category}` : `List: ${decision.matchedRule ?? decision.host}`
    });
    this.commit('state');

    const blocked: BlockedNavigationInfo = {
      url,
      host: decision.host,
      action: 'block',
      reason: decision.reason,
      ...(decision.classification ? { classification: decision.classification } : {})
    };
    return {
      kind: 'intercept',
      blocked,
      interstitialUrl: buildInterstitialUrl({ blocked, sessionEndsAt: this.session?.endsAt ?? null })
    };
  }

  isAllowed(url: string): boolean {
    return evaluateStudyPolicy(url, this.policyContext(url)).action === 'allow';
  }

  onPageCommitted(page: CommittedPage): void {
    if (page.isActiveTab) {
      this.onActivePageChanged(page.url);
    }
    const host = getPolicyHost(page.url);
    if (!this.session || !this.stats || !host) {
      return;
    }
    this.stats.pagesVisited += 1;
    this.logEvent('visit', { host, url: page.url, detail: page.title || undefined });
    this.commit('state');
  }

  onActivePageChanged(url: string | null): void {
    this.tick();
    this.activeHost = url ? getPolicyHost(url) : null;
  }

  // Internals -----------------------------------------------------------------

  private policyContext(url: string): PolicyContext {
    return {
      studyActive: this.session !== null,
      policy: this.deps.getPolicy(),
      classification: this.session ? this.classificationLookup(url) : null
    };
  }

  /** Classifies a page once per key and records the verdict. Never rejects. */
  private checkPage(url: string): Promise<void> {
    const key = classificationKey(url, this.deps.getPolicy().classification) ?? url;
    const pending = this.pendingChecks.get(key);
    if (pending) {
      return pending;
    }
    if (!this.classifyPage) {
      return Promise.resolve();
    }

    const sessionId = this.session?.id;
    const check = this.classifyPage(url)
      .then((classification) => {
        if (!this.session || this.session.id !== sessionId || !this.stats) {
          return;
        }
        const allowed = this.isAllowed(url);
        this.stats.aiChecks += 1;
        if (allowed) this.stats.aiAllowed += 1;
        this.stats.categoryCounts[classification.category] = (this.stats.categoryCounts[classification.category] ?? 0) + 1;
        this.logEvent('classified', {
          host: classification.host,
          url,
          detail: `${classification.category} ${Math.round(classification.confidence * 100)}%${classification.fallback ? ' (offline)' : ''} · ${allowed ? 'allowed' : 'blocked'}`
        });
        this.commit('state');
      })
      .catch(() => undefined)
      .finally(() => this.pendingChecks.delete(key));
    this.pendingChecks.set(key, check);
    return check;
  }

  /** Attributes the time since the last tick to focused/away and to the foreground host. */
  private tick(): void {
    if (!this.session || !this.stats) {
      return;
    }
    const now = this.session.endsAt === null ? this.now() : Math.min(this.now(), this.session.endsAt);
    const elapsed = Math.max(0, now - this.lastTick);
    this.lastTick = Math.max(this.lastTick, now);
    if (elapsed === 0) {
      return;
    }
    if (this.windowFocused) {
      this.stats.focusedMs += elapsed;
      if (this.activeHost) {
        this.stats.hostMs[this.activeHost] = (this.stats.hostMs[this.activeHost] ?? 0) + elapsed;
      }
    } else {
      this.stats.awayMs += elapsed;
    }
  }

  private restoreActiveSession(data: PersistedStudyData): void {
    const active = data.activeSession;
    if (!active) {
      return;
    }
    this.session = active.session;
    this.stats = normalizeStats(active.stats);
    // Time while the app was closed is not counted as focused or away.
    this.lastTick = active.session.endsAt === null ? this.now() : Math.min(this.now(), active.session.endsAt);
    if (active.session.endsAt !== null && active.session.endsAt <= this.now()) {
      this.stopSession('completed');
    } else {
      this.scheduleSessionEnd();
    }
  }

  private scheduleSessionEnd(): void {
    this.clearEndTimer();
    if (!this.session || this.session.endsAt === null) {
      return;
    }
    const delay = Math.max(0, this.session.endsAt - this.now());
    this.endTimer = this.scheduleTimeout(() => {
      this.endTimer = null;
      this.stopSession('completed');
    }, delay);
  }

  private clearEndTimer(): void {
    if (this.endTimer !== null) {
      this.cancelTimeout(this.endTimer);
      this.endTimer = null;
    }
  }

  private logEvent(type: StudyEventType, fields: Partial<Pick<StudyEvent, 'host' | 'url' | 'detail'>> = {}): void {
    this.events.push({ id: this.createId(), type, at: this.now(), sessionId: this.session?.id ?? null, ...fields });
    if (this.events.length > MAX_STORED_EVENTS) {
      this.events.splice(0, this.events.length - MAX_STORED_EVENTS);
    }
  }

  private commit(kind: StudyChangeKind): void {
    this.tick();
    this.store.save({
      version: 2,
      settings: this.settings,
      settingsUpdatedAt: this.settingsUpdatedAt,
      activeSession: this.session && this.stats ? { session: { ...this.session }, stats: normalizeStats(this.stats), overrides: [] } : null,
      events: [...this.events],
      sessions: [...this.sessions]
    });
    for (const listener of this.listeners) {
      listener(kind);
    }
  }
}
