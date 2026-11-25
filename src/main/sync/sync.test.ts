import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { StudySessionSummary } from '../../shared/ipc.js';
import { DEFAULT_STUDY_SETTINGS, FALLBACK_POLICY, StudySettings } from '../../shared/study-policy.js';
import { AccountService, AccountStore, AccountData, parseAccountData, SyncParticipant } from '../account/account-service.js';
import { StudyModeService } from '../study/study-mode-service.js';
import { MemoryStudyStore } from '../study/study-store.js';
import { LocalSyncState, mergeSync, parseSyncDocument, SYNC_FORMAT, SyncFormatError } from './sync-engine.js';
import { FolderSyncTransport, SYNC_FILE_NAME } from './sync-transport.js';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function summary(id: string, startedAt: number, hostMs: Record<string, number> = { 'github.com': 1000 }): StudySessionSummary {
  return {
    id,
    startedAt,
    endsAt: startedAt + 1500_000,
    endedAt: startedAt + 1500_000,
    durationMinutes: 25,
    endReason: 'completed',
    stats: { focusedMs: 1000, awayMs: 0, focusLosses: 0, blockedCount: 1, blockedByList: 1, blockedByAi: 0, aiChecks: 0, aiAllowed: 0, pagesVisited: 1, hostMs, blockedHosts: { 'reddit.com': 1 }, categoryCounts: {} }
  };
}

function local(overrides: Partial<LocalSyncState> = {}): LocalSyncState {
  return {
    deviceId: 'device-a',
    deviceName: 'Laptop',
    settings: DEFAULT_STUDY_SETTINGS,
    settingsUpdatedAt: 100,
    sessions: [],
    includeBrowsingDetails: false,
    ...overrides
  };
}

describe('mergeSync', () => {
  it('creates a document from local data, stripping per-site times by default', () => {
    const result = mergeSync(local({ sessions: [summary('s1', 1)] }), null, 500);
    expect(result.document).toMatchObject({ format: SYNC_FORMAT, schemaVersion: 1, updatedAt: 500 });
    expect(result.document.devices['device-a']).toEqual({ name: 'Laptop', lastSyncAt: 500 });
    expect(result.document.sessions[0]?.stats.hostMs).toEqual({});
    expect(result.applySettings).toBeNull();
    expect(result.importSessions).toEqual([]);
  });

  it('keeps per-site times when opted in', () => {
    const result = mergeSync(local({ sessions: [summary('s1', 1)], includeBrowsingDetails: true }), null, 500);
    expect(result.document.sessions[0]?.stats.hostMs).toEqual({ 'github.com': 1000 });
  });

  it('unions sessions and imports only unknown ones', () => {
    const remote = mergeSync(local({ deviceId: 'device-b', sessions: [summary('b1', 2), summary('shared', 1)] }), null, 10).document;
    const result = mergeSync(local({ sessions: [summary('a1', 3), summary('shared', 1)] }), remote, 20);
    expect(result.document.sessions.map((s) => s.id)).toEqual(['shared', 'b1', 'a1']);
    expect(result.importSessions.map((s) => s.id)).toEqual(['b1']);
    expect(Object.keys(result.document.devices).sort()).toEqual(['device-a', 'device-b']);
  });

  it('resolves settings by last writer wins with a deterministic tie-break', () => {
    const newer: StudySettings = { defaultDurationMinutes: 50 };
    const remote = mergeSync(local({ deviceId: 'device-b', settings: newer, settingsUpdatedAt: 200 }), null, 10).document;

    expect(mergeSync(local({ settingsUpdatedAt: 100 }), remote, 20).applySettings).toEqual({ value: newer, updatedAt: 200 });
    expect(mergeSync(local({ settingsUpdatedAt: 300 }), remote, 20).applySettings).toBeNull();
    // Tie: higher device id wins on every device.
    expect(mergeSync(local({ deviceId: 'device-a', settingsUpdatedAt: 200 }), remote, 20).applySettings).not.toBeNull();
    expect(mergeSync(local({ deviceId: 'device-c', settingsUpdatedAt: 200 }), remote, 20).applySettings).toBeNull();
  });

  it('rejects foreign and newer documents, sanitizes the rest', () => {
    expect(parseSyncDocument(null)).toBeNull();
    expect(() => parseSyncDocument({ format: 'other' })).toThrow(SyncFormatError);
    expect(() => parseSyncDocument({ format: SYNC_FORMAT, schemaVersion: 99 })).toThrow('newer StudyNest');
    const parsed = parseSyncDocument({
      format: SYNC_FORMAT,
      schemaVersion: 1,
      settings: { value: { defaultDurationMinutes: 9999, blocklist: ['x.com'] }, updatedAt: 5, deviceId: 'd' },
      sessions: [summary('ok', 1), { id: 'bad' }]
    });
    expect(parsed?.settings?.value).toEqual({ defaultDurationMinutes: 240 });
    expect(parsed?.sessions.map((s) => s.id)).toEqual(['ok']);
  });
});

class MemoryAccountStore implements AccountStore {
  constructor(private data: AccountData) {}
  load() {
    return structuredClone(this.data);
  }
  save(data: AccountData) {
    this.data = structuredClone(data);
  }
  flush() {}
}

function device(name: string, folder: string, clock: { now: number }) {
  let id = 0;
  const study = new StudyModeService({
    store: new MemoryStudyStore(),
    getPolicy: () => FALLBACK_POLICY,
    now: () => clock.now,
    createId: () => `${name}-${++id}`,
    scheduleTimeout: () => null,
    cancelTimeout: () => undefined
  });
  const account = new AccountService({
    store: new MemoryAccountStore(parseAccountData({ device: { id: `id-${name}`, name } })),
    participant: study as SyncParticipant,
    createTransport: (dir) => new FolderSyncTransport(dir),
    now: () => clock.now
  });
  account.configureSync({ folder });
  return { study, account };
}

describe('folder sync between two devices', () => {
  it('converges settings and session history through a shared folder', async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'studynest-sync-'));
    tempDirs.push(folder);
    const clock = { now: 1_000_000 };
    const laptop = device('laptop', folder, clock);
    const desktop = device('desktop', folder, clock);

    laptop.study.startSession(25);
    clock.now += 60_000;
    laptop.study.stopSession();
    await laptop.account.syncNow();
    expect(fs.existsSync(path.join(folder, SYNC_FILE_NAME))).toBe(true);

    clock.now += 1000;
    desktop.study.updateSettings({ defaultDurationMinutes: 50 });
    desktop.study.startSession(25);
    clock.now += 60_000;
    desktop.study.stopSession();
    await desktop.account.syncNow();
    await laptop.account.syncNow();

    const laptopState = laptop.study.getSyncState();
    const desktopState = desktop.study.getSyncState();
    expect(laptopState.sessions.map((s) => s.id).sort()).toEqual(desktopState.sessions.map((s) => s.id).sort());
    expect(laptopState.sessions).toHaveLength(2);
    expect(laptopState.settings.defaultDurationMinutes).toBe(50);
    expect(laptop.account.getSnapshot().sync).toMatchObject({ lastError: null, syncing: false });

    // The shared file never contains the activity log or per-site times.
    const shared = fs.readFileSync(path.join(folder, SYNC_FILE_NAME), 'utf-8');
    expect(shared).not.toContain('recentEvents');
    expect(JSON.parse(shared).sessions.every((s: StudySessionSummary) => Object.keys(s.stats.hostMs).length === 0)).toBe(true);
  });

  it('reports a corrupt sync file without touching local data', async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'studynest-sync-'));
    tempDirs.push(folder);
    fs.writeFileSync(path.join(folder, SYNC_FILE_NAME), '{broken');
    const clock = { now: 1 };
    const laptop = device('laptop', folder, clock);
    const snapshot = await laptop.account.syncNow();
    expect(snapshot.sync.lastError).toBeTruthy();
    expect(fs.readFileSync(path.join(folder, SYNC_FILE_NAME), 'utf-8')).toBe('{broken');
  });

  it('sanitizes synced settings before applying them', () => {
    const clock = { now: 1 };
    const { study } = device('laptop', os.tmpdir(), clock);
    study.applySyncedData({ settings: { value: { defaultDurationMinutes: 100000 } as never, updatedAt: 99 }, sessions: [] });
    expect(study.getSyncState().settings).toEqual({ defaultDurationMinutes: 240 });
    expect(study.getSyncState().settingsUpdatedAt).toBe(99);
  });
});
