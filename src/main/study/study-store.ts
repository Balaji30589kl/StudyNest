import type { StudyEvent, StudySessionState, StudySessionStats, StudySessionSummary } from '../../shared/ipc.js';
import { JsonFileStore } from '../storage/json-file-store.js';
import { DEFAULT_STUDY_SETTINGS, StudySettings, sanitizeStudySettings } from '../../shared/study-policy.js';

export const STUDY_DATA_VERSION = 1;
export const MAX_STORED_EVENTS = 1000;
export const MAX_STORED_SESSIONS = 200;

export type PersistedActiveSession = {
  session: StudySessionState;
  stats: StudySessionStats;
  overrides: string[];
};

export type PersistedStudyData = {
  version: number;
  settings: StudySettings;
  /** When settings last changed (local edit or sync). Used for last-writer-wins sync. */
  settingsUpdatedAt: number;
  activeSession: PersistedActiveSession | null;
  events: StudyEvent[];
  sessions: StudySessionSummary[];
};

/** Storage boundary for Study Mode. Only the main process touches this. */
export interface StudyStore {
  load(): PersistedStudyData;
  save(data: PersistedStudyData): void;
  /** Write any pending data immediately (called on quit). */
  flush(): void;
}

export function createEmptyStudyData(): PersistedStudyData {
  return {
    version: STUDY_DATA_VERSION,
    settings: sanitizeStudySettings(undefined, DEFAULT_STUDY_SETTINGS),
    settingsUpdatedAt: 0,
    activeSession: null,
    events: [],
    sessions: []
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Validates data read from disk; anything malformed falls back to defaults. */
export function parseStudyData(raw: unknown): PersistedStudyData {
  const empty = createEmptyStudyData();
  if (!isRecord(raw)) {
    return empty;
  }

  const events = Array.isArray(raw.events)
    ? raw.events.filter((event): event is StudyEvent => isRecord(event) && typeof event.type === 'string' && typeof event.at === 'number')
    : [];
  const sessions = Array.isArray(raw.sessions)
    ? raw.sessions.filter(
        (session): session is StudySessionSummary =>
          isRecord(session) && typeof session.id === 'string' && typeof session.startedAt === 'number' && isRecord(session.stats)
      )
    : [];

  let activeSession: PersistedActiveSession | null = null;
  if (isRecord(raw.activeSession) && isRecord(raw.activeSession.session) && isRecord(raw.activeSession.stats)) {
    const candidate = raw.activeSession as unknown as PersistedActiveSession;
    if (typeof candidate.session.id === 'string' && (typeof candidate.session.endsAt === 'number' || candidate.session.endsAt === null)) {
      activeSession = {
        session: candidate.session,
        stats: candidate.stats,
        overrides: Array.isArray(candidate.overrides) ? candidate.overrides.filter((host) => typeof host === 'string') : []
      };
    }
  }

  return {
    version: STUDY_DATA_VERSION,
    settings: sanitizeStudySettings(raw.settings, DEFAULT_STUDY_SETTINGS),
    settingsUpdatedAt: typeof raw.settingsUpdatedAt === 'number' ? raw.settingsUpdatedAt : 0,
    activeSession,
    events: events.slice(-MAX_STORED_EVENTS),
    sessions: sessions.slice(-MAX_STORED_SESSIONS)
  };
}

export class MemoryStudyStore implements StudyStore {
  constructor(private data: PersistedStudyData = createEmptyStudyData()) {}

  load(): PersistedStudyData {
    return structuredClone(this.data);
  }

  save(data: PersistedStudyData): void {
    this.data = structuredClone(data);
  }

  flush(): void {}
}

/** JSON file store with debounced, atomic (write-then-rename) saves. */
export class JsonFileStudyStore implements StudyStore {
  private readonly file: JsonFileStore<PersistedStudyData>;

  constructor(filePath: string, debounceMs = 500) {
    this.file = new JsonFileStore(filePath, parseStudyData, debounceMs);
  }

  load(): PersistedStudyData {
    return this.file.load();
  }

  save(data: PersistedStudyData): void {
    this.file.save(data);
  }

  flush(): void {
    this.file.flush();
  }
}
