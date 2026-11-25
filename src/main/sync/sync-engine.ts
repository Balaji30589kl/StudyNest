import type { StudySessionSummary } from '../../shared/ipc.js';
import { isPageCategory } from '../../shared/classification.js';
import { sanitizeStudySettings, StudySettings } from '../../shared/study-policy.js';

/**
 * Sync foundation: a deterministic, conflict-free merge between this device's
 * data and a shared sync document. Pure; transports only move JSON around.
 *
 * What syncs: Study settings (last writer wins) and finished session summaries
 * (immutable, unioned by id). What never syncs: the activity log (URLs), the
 * AI cache, and API keys. Per-host times sync only when the user opts in.
 */

export const SYNC_FORMAT = 'studynest-sync';
export const SYNC_SCHEMA_VERSION = 1;
export const MAX_SYNCED_SESSIONS = 1000;

export type SyncedSettings = { value: StudySettings; updatedAt: number; deviceId: string };

export type SyncDocument = {
  format: typeof SYNC_FORMAT;
  schemaVersion: number;
  updatedAt: number;
  devices: Record<string, { name: string; lastSyncAt: number }>;
  settings: SyncedSettings | null;
  sessions: StudySessionSummary[];
};

export type LocalSyncState = {
  deviceId: string;
  deviceName: string;
  settings: StudySettings;
  settingsUpdatedAt: number;
  sessions: StudySessionSummary[];
  includeBrowsingDetails: boolean;
};

export type SyncMergeResult = {
  document: SyncDocument;
  /** Remote settings that are newer than local and should be applied. */
  applySettings: { value: StudySettings; updatedAt: number } | null;
  /** Sessions recorded on other devices that this device does not have yet. */
  importSessions: StudySessionSummary[];
};

export class SyncFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncFormatError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSessionSummary(value: unknown): value is StudySessionSummary {
  if (!isRecord(value) || !isRecord(value.stats)) {
    return false;
  }
  const stats = value.stats;
  return (
    typeof value.id === 'string' &&
    typeof value.startedAt === 'number' &&
    (typeof value.endsAt === 'number' || value.endsAt === null) &&
    typeof value.endedAt === 'number' &&
    (typeof value.durationMinutes === 'number' || value.durationMinutes === null) &&
    (value.endReason === 'completed' || value.endReason === 'stopped') &&
    typeof stats.focusedMs === 'number' &&
    typeof stats.awayMs === 'number' &&
    typeof stats.blockedCount === 'number'
  );
}

function numberMap(value: unknown): Record<string, number> {
  return isRecord(value)
    ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])))
    : {};
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

/** Copies only known, numeric stats from an untrusted session (older versions lack some fields). */
function normalizeSession(session: StudySessionSummary): StudySessionSummary {
  const stats = session.stats as unknown as Record<string, unknown>;
  const categories = numberMap(stats.categoryCounts);
  return {
    ...session,
    stats: {
      focusedMs: count(stats.focusedMs),
      awayMs: count(stats.awayMs),
      focusLosses: count(stats.focusLosses),
      blockedCount: count(stats.blockedCount),
      blockedByList: count(stats.blockedByList),
      blockedByAi: count(stats.blockedByAi),
      aiChecks: count(stats.aiChecks),
      aiAllowed: count(stats.aiAllowed),
      pagesVisited: count(stats.pagesVisited),
      hostMs: numberMap(stats.hostMs),
      blockedHosts: numberMap(stats.blockedHosts),
      categoryCounts: Object.fromEntries(Object.entries(categories).filter(([category]) => isPageCategory(category)))
    }
  };
}

/** Validates an untrusted sync document. Throws on newer or foreign formats. */
export function parseSyncDocument(raw: unknown): SyncDocument | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (!isRecord(raw) || raw.format !== SYNC_FORMAT) {
    throw new SyncFormatError('Not a StudyNest sync file.');
  }
  const schemaVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  if (schemaVersion > SYNC_SCHEMA_VERSION) {
    throw new SyncFormatError('The sync file was written by a newer StudyNest. Update this device to keep syncing.');
  }

  const devices: SyncDocument['devices'] = {};
  if (isRecord(raw.devices)) {
    for (const [id, device] of Object.entries(raw.devices)) {
      if (isRecord(device) && typeof device.name === 'string' && typeof device.lastSyncAt === 'number') {
        devices[id] = { name: device.name.slice(0, 80), lastSyncAt: device.lastSyncAt };
      }
    }
  }

  let settings: SyncedSettings | null = null;
  if (isRecord(raw.settings) && typeof raw.settings.updatedAt === 'number' && typeof raw.settings.deviceId === 'string') {
    settings = {
      value: sanitizeStudySettings(raw.settings.value),
      updatedAt: raw.settings.updatedAt,
      deviceId: raw.settings.deviceId
    };
  }

  return {
    format: SYNC_FORMAT,
    schemaVersion: SYNC_SCHEMA_VERSION,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
    devices,
    settings,
    sessions: Array.isArray(raw.sessions) ? raw.sessions.filter(isSessionSummary).map(normalizeSession) : []
  };
}

function stripBrowsingDetails(session: StudySessionSummary): StudySessionSummary {
  return { ...session, stats: { ...session.stats, hostMs: {}, blockedHosts: {} } };
}

/** Last writer wins; ties break on device id so every device picks the same winner. */
function remoteSettingsWin(local: LocalSyncState, remote: SyncedSettings | null): boolean {
  if (!remote) {
    return false;
  }
  if (remote.updatedAt !== local.settingsUpdatedAt) {
    return remote.updatedAt > local.settingsUpdatedAt;
  }
  return remote.deviceId > local.deviceId;
}

export function mergeSync(local: LocalSyncState, remote: SyncDocument | null, now: number): SyncMergeResult {
  const remoteWins = remoteSettingsWin(local, remote?.settings ?? null);
  const settings: SyncedSettings =
    remoteWins && remote?.settings
      ? remote.settings
      : { value: local.settings, updatedAt: local.settingsUpdatedAt, deviceId: local.deviceId };

  const localIds = new Set(local.sessions.map((session) => session.id));
  const merged = new Map<string, StudySessionSummary>();
  for (const session of remote?.sessions ?? []) {
    merged.set(session.id, session);
  }
  for (const session of local.sessions) {
    merged.set(session.id, local.includeBrowsingDetails ? session : stripBrowsingDetails(session));
  }

  const sessions = [...merged.values()].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id)).slice(-MAX_SYNCED_SESSIONS);

  return {
    document: {
      format: SYNC_FORMAT,
      schemaVersion: SYNC_SCHEMA_VERSION,
      updatedAt: now,
      devices: { ...(remote?.devices ?? {}), [local.deviceId]: { name: local.deviceName, lastSyncAt: now } },
      settings,
      sessions
    },
    // Applied even when values are equal so the local timestamp converges too.
    applySettings: remoteWins && remote?.settings ? { value: remote.settings.value, updatedAt: remote.settings.updatedAt } : null,
    importSessions: (remote?.sessions ?? []).filter((session) => !localIds.has(session.id))
  };
}
