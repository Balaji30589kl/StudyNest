import { randomUUID } from 'node:crypto';
import type { AccountStateSnapshot, StudySessionSummary } from '../../shared/ipc.js';
import type { StudySettings } from '../../shared/study-policy.js';
import { mergeSync, parseSyncDocument } from '../sync/sync-engine.js';
import type { SyncTransport } from '../sync/sync-transport.js';

export const ACCOUNT_SCHEMA_VERSION = 1;

/** What the account layer needs from the Study layer. Keeps the dependency one-way. */
export interface SyncParticipant {
  getSyncState(): { settings: StudySettings; settingsUpdatedAt: number; sessions: StudySessionSummary[] };
  applySyncedData(data: { settings: { value: StudySettings; updatedAt: number } | null; sessions: StudySessionSummary[] }): void;
}

export type AccountData = {
  schemaVersion: number;
  profile: { id: string; displayName: string; createdAt: number };
  device: { id: string; name: string };
  sync: {
    folder: string | null;
    includeBrowsingDetails: boolean;
    lastSyncAt: number | null;
    lastError: string | null;
  };
};

export interface AccountStore {
  load(): AccountData;
  save(data: AccountData): void;
  flush(): void;
}

function clipName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.replace(/\s+/g, ' ').trim().slice(0, 60);
  return trimmed.length > 0 ? trimmed : fallback;
}

/** Validates stored account data; creates a fresh local profile when missing. */
export function parseAccountData(raw: unknown, createId: () => string = randomUUID, now = Date.now(), defaultDeviceName = 'This device'): AccountData {
  const candidate = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const profile = typeof candidate.profile === 'object' && candidate.profile !== null ? (candidate.profile as Record<string, unknown>) : {};
  const device = typeof candidate.device === 'object' && candidate.device !== null ? (candidate.device as Record<string, unknown>) : {};
  const sync = typeof candidate.sync === 'object' && candidate.sync !== null ? (candidate.sync as Record<string, unknown>) : {};

  return {
    schemaVersion: ACCOUNT_SCHEMA_VERSION,
    profile: {
      id: typeof profile.id === 'string' ? profile.id : createId(),
      displayName: clipName(profile.displayName, 'Student'),
      createdAt: typeof profile.createdAt === 'number' ? profile.createdAt : now
    },
    device: {
      id: typeof device.id === 'string' ? device.id : createId(),
      name: clipName(device.name, defaultDeviceName)
    },
    sync: {
      folder: typeof sync.folder === 'string' && sync.folder.length > 0 ? sync.folder : null,
      includeBrowsingDetails: sync.includeBrowsingDetails === true,
      lastSyncAt: typeof sync.lastSyncAt === 'number' ? sync.lastSyncAt : null,
      lastError: typeof sync.lastError === 'string' ? sync.lastError : null
    }
  };
}

export type AccountServiceDeps = {
  store: AccountStore;
  participant: SyncParticipant;
  createTransport: (folder: string) => SyncTransport;
  now?: () => number;
  log?: (level: 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>) => void;
  autoSyncDelayMs?: number;
};

/**
 * Local-first account: a profile, a device identity, and sync configuration.
 * There is no server login yet; a cloud identity provider can attach to the
 * same profile id later without changing the Study or AI layers.
 */
export class AccountService {
  private data: AccountData;
  private readonly now: () => number;
  private readonly listeners = new Set<() => void>();
  private syncing: Promise<AccountStateSnapshot> | null = null;
  private autoSyncTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: AccountServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.data = deps.store.load();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): AccountStateSnapshot {
    return {
      profile: { ...this.data.profile },
      device: { ...this.data.device },
      sync: { ...this.data.sync, syncing: this.syncing !== null }
    };
  }

  updateProfile(input: unknown): AccountStateSnapshot {
    const candidate = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
    this.data.profile.displayName = clipName(candidate.displayName, this.data.profile.displayName);
    this.data.device.name = clipName(candidate.deviceName, this.data.device.name);
    this.commit();
    return this.getSnapshot();
  }

  configureSync(input: { folder?: string | null; includeBrowsingDetails?: boolean }): AccountStateSnapshot {
    if (input.folder !== undefined) {
      this.data.sync.folder = input.folder && input.folder.trim().length > 0 ? input.folder : null;
      this.data.sync.lastError = null;
    }
    if (typeof input.includeBrowsingDetails === 'boolean') {
      this.data.sync.includeBrowsingDetails = input.includeBrowsingDetails;
    }
    this.commit();
    return this.getSnapshot();
  }

  /** Debounced background sync after local changes. No-op when sync is off. */
  scheduleSync(): void {
    if (!this.data.sync.folder) {
      return;
    }
    if (this.autoSyncTimer) {
      clearTimeout(this.autoSyncTimer);
    }
    this.autoSyncTimer = setTimeout(() => {
      this.autoSyncTimer = null;
      void this.syncNow();
    }, this.deps.autoSyncDelayMs ?? 5000);
  }

  syncNow(): Promise<AccountStateSnapshot> {
    if (this.syncing) {
      return this.syncing;
    }
    this.syncing = this.runSync()
      .finally(() => {
        this.syncing = null;
        this.emit();
      })
      // Snapshot after the in-flight flag clears, so callers never see a stale "syncing".
      .then(() => this.getSnapshot());
    this.emit();
    return this.syncing;
  }

  dispose(): void {
    if (this.autoSyncTimer) {
      clearTimeout(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }
    this.deps.store.flush();
  }

  private async runSync(): Promise<AccountStateSnapshot> {
    const folder = this.data.sync.folder;
    if (!folder) {
      return this.getSnapshot();
    }

    const transport = this.deps.createTransport(folder);
    try {
      const remote = parseSyncDocument(await transport.read());
      const local = this.deps.participant.getSyncState();
      const result = mergeSync(
        {
          deviceId: this.data.device.id,
          deviceName: this.data.device.name,
          settings: local.settings,
          settingsUpdatedAt: local.settingsUpdatedAt,
          sessions: local.sessions,
          includeBrowsingDetails: this.data.sync.includeBrowsingDetails
        },
        remote,
        this.now()
      );

      if (result.applySettings || result.importSessions.length > 0) {
        this.deps.participant.applySyncedData({ settings: result.applySettings, sessions: result.importSessions });
      }
      await transport.write(result.document);

      this.data.sync.lastSyncAt = this.now();
      this.data.sync.lastError = null;
      this.deps.log?.('info', 'sync completed', {
        transport: transport.kind,
        imported: result.importSessions.length,
        settingsApplied: result.applySettings !== null,
        totalSessions: result.document.sessions.length
      });
    } catch (error) {
      this.data.sync.lastError = error instanceof Error ? error.message : String(error);
      this.deps.log?.('warn', 'sync failed', { error: this.data.sync.lastError });
    }

    this.commit();
    return this.getSnapshot();
  }

  private commit(): void {
    this.deps.store.save(structuredClone(this.data));
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
