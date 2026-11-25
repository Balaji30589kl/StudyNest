import { randomUUID } from 'node:crypto';
import type { HistoryEntry, HistorySuggestion, TopSite } from '../../shared/ipc.js';

export type PersistedHistory = { version: 1; entries: HistoryEntry[] };

export interface HistoryStore {
  load(): PersistedHistory;
  save(data: PersistedHistory): void;
  flush(): void;
}

const MAX_ENTRIES = 20_000;
const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
/** A revisit of the same URL within this window updates the last entry (reloads, in-page changes). */
const MERGE_WINDOW_MS = 60 * 1000;
const TOP_SITES_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function isEntry(value: unknown): value is HistoryEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === 'string' && typeof entry.url === 'string' && typeof entry.title === 'string' && typeof entry.visitedAt === 'number';
}

export function parseHistory(raw: unknown): PersistedHistory {
  const candidate = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const entries = Array.isArray(candidate.entries) ? candidate.entries.filter(isEntry) : [];
  return { version: 1, entries: entries.map((entry) => ({ ...entry, host: entry.host || hostOf(entry.url) })) };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isRecordable(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function tokensOf(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(Boolean);
}

function matchesAll(entry: HistoryEntry, tokens: string[]): boolean {
  const haystack = `${entry.title} ${entry.url}`.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

/** Browsing history: every top-level page visit, kept for 180 days. */
export class HistoryService {
  private entries: HistoryEntry[];
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;

  constructor(
    private readonly store: HistoryStore,
    now?: () => number
  ) {
    this.now = now ?? Date.now;
    const cutoff = this.now() - MAX_AGE_MS;
    this.entries = store.load().entries.filter((entry) => entry.visitedAt >= cutoff).slice(-MAX_ENTRIES);
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  record(url: string, title: string): void {
    if (!isRecordable(url)) return;
    const now = this.now();
    const last = this.entries.at(-1);
    if (last && last.url === url && now - last.visitedAt < MERGE_WINDOW_MS) {
      last.visitedAt = now;
      if (title) last.title = title;
    } else {
      this.entries.push({ id: randomUUID(), url, title: title || '', host: hostOf(url), visitedAt: now });
      if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    }
    this.commit();
  }

  /** Titles often arrive after the visit is recorded. */
  updateTitle(url: string, title: string): void {
    if (!title) return;
    for (let index = this.entries.length - 1, checked = 0; index >= 0 && checked < 30; index -= 1, checked += 1) {
      const entry = this.entries[index]!;
      if (entry.url === url) {
        if (entry.title !== title) {
          entry.title = title;
          this.commit();
        }
        return;
      }
    }
  }

  /** Newest first, optionally filtered by text and limited to visits before `before`. */
  query(options: { text?: string; limit?: number; before?: number } = {}): HistoryEntry[] {
    const tokens = tokensOf(options.text ?? '');
    const limit = Math.min(Math.max(options.limit ?? 200, 1), 1000);
    const result: HistoryEntry[] = [];
    for (let index = this.entries.length - 1; index >= 0 && result.length < limit; index -= 1) {
      const entry = this.entries[index]!;
      if (options.before !== undefined && entry.visitedAt >= options.before) continue;
      if (tokens.length === 0 || matchesAll(entry, tokens)) result.push({ ...entry });
    }
    return result;
  }

  /**
   * Address-bar suggestions: one per URL, ranked by how often and how recently
   * it was visited, with a strong bonus when the typed text starts the host.
   */
  suggest(text: string, limit = 6): HistorySuggestion[] {
    const tokens = tokensOf(text);
    if (tokens.length === 0) return [];
    const first = tokens[0]!.replace(/^https?:\/\//, '').replace(/^www\./, '');
    const byUrl = new Map<string, { entry: HistoryEntry; visits: number }>();
    for (const entry of this.entries) {
      if (!matchesAll(entry, tokens)) continue;
      const existing = byUrl.get(entry.url);
      if (existing) {
        existing.visits += 1;
        existing.entry = entry;
      } else {
        byUrl.set(entry.url, { entry, visits: 1 });
      }
    }
    const now = this.now();
    return [...byUrl.values()]
      .map(({ entry, visits }) => {
        const ageDays = (now - entry.visitedAt) / DAY_MS;
        let score = Math.log2(visits + 1) * 10 + Math.max(0, 30 - ageDays);
        if (entry.host.startsWith(first)) score += 40;
        if (entry.title.toLowerCase().startsWith(tokens.join(' '))) score += 10;
        // Prefer a site's front page over deep links when both match.
        try {
          if (new URL(entry.url).pathname === '/') score += 5;
        } catch {
          // Unparseable URLs keep their score.
        }
        return { url: entry.url, title: entry.title, visits, lastVisitedAt: entry.visitedAt, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ score: _score, ...rest }) => rest);
  }

  /** Most visited sites of the last 60 days, for the new tab page. */
  topSites(limit = 8): TopSite[] {
    const cutoff = this.now() - TOP_SITES_WINDOW_MS;
    const byHost = new Map<string, { visits: number; latest: HistoryEntry; rootTitle: string | null }>();
    for (const entry of this.entries) {
      if (entry.visitedAt < cutoff || !entry.host) continue;
      const site = byHost.get(entry.host) ?? { visits: 0, latest: entry, rootTitle: null };
      site.visits += 1;
      site.latest = entry;
      try {
        if (new URL(entry.url).pathname === '/' && entry.title) site.rootTitle = entry.title;
      } catch {
        // Ignore.
      }
      byHost.set(entry.host, site);
    }
    return [...byHost.entries()]
      .sort((a, b) => b[1].visits - a[1].visits || b[1].latest.visitedAt - a[1].latest.visitedAt)
      .slice(0, limit)
      .map(([host, site]) => {
        let url = site.latest.url;
        try {
          const parsed = new URL(site.latest.url);
          url = `${parsed.protocol}//${parsed.host}/`;
        } catch {
          // Keep the latest URL.
        }
        return { url, host, title: site.rootTitle ?? host, visits: site.visits };
      });
  }

  delete(ids: string[]): void {
    const remove = new Set(ids);
    const before = this.entries.length;
    this.entries = this.entries.filter((entry) => !remove.has(entry.id));
    if (this.entries.length !== before) this.commit();
  }

  /** Clears visits since `since` (0 clears everything). */
  clear(since = 0): void {
    this.entries = since > 0 ? this.entries.filter((entry) => entry.visitedAt < since) : [];
    this.commit();
  }

  flush(): void {
    this.store.flush();
  }

  private commit(): void {
    this.store.save({ version: 1, entries: this.entries });
    for (const listener of this.listeners) listener();
  }
}
