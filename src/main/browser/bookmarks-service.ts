import { randomUUID } from 'node:crypto';
import type { Bookmark } from '../../shared/ipc.js';

export type PersistedBookmarks = { version: 1; bookmarks: Bookmark[] };

export interface BookmarksStore {
  load(): PersistedBookmarks;
  save(data: PersistedBookmarks): void;
  flush(): void;
}

const MAX_BOOKMARKS = 5000;
const MAX_TITLE = 300;

function isBookmark(value: unknown): value is Bookmark {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === 'string' && typeof entry.url === 'string' && typeof entry.title === 'string' && typeof entry.createdAt === 'number';
}

export function parseBookmarks(raw: unknown): PersistedBookmarks {
  const candidate = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return { version: 1, bookmarks: Array.isArray(candidate.bookmarks) ? candidate.bookmarks.filter(isBookmark).slice(0, MAX_BOOKMARKS) : [] };
}

function isBookmarkable(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function cleanTitle(title: string, url: string): string {
  const trimmed = title.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
  if (trimmed) return trimmed;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Bookmarks in the order they appear on the bookmarks bar. */
export class BookmarksService {
  private bookmarks: Bookmark[];
  private readonly listeners = new Set<(bookmarks: Bookmark[]) => void>();

  constructor(
    private readonly store: BookmarksStore,
    private readonly now: () => number = Date.now
  ) {
    this.bookmarks = store.load().bookmarks;
  }

  onChange(listener: (bookmarks: Bookmark[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(): Bookmark[] {
    return this.bookmarks.map((bookmark) => ({ ...bookmark }));
  }

  isBookmarked(url: string): boolean {
    return this.bookmarks.some((bookmark) => bookmark.url === url);
  }

  add(url: string, title: string): Bookmark[] {
    if (!isBookmarkable(url) || this.isBookmarked(url) || this.bookmarks.length >= MAX_BOOKMARKS) return this.list();
    this.bookmarks.push({ id: randomUUID(), url, title: cleanTitle(title, url), createdAt: this.now() });
    return this.commit();
  }

  /** Adds the page, or removes it when it is already bookmarked. */
  toggle(url: string, title: string): Bookmark[] {
    return this.isBookmarked(url) ? this.removeUrl(url) : this.add(url, title);
  }

  remove(id: string): Bookmark[] {
    const before = this.bookmarks.length;
    this.bookmarks = this.bookmarks.filter((bookmark) => bookmark.id !== id);
    return this.bookmarks.length === before ? this.list() : this.commit();
  }

  removeUrl(url: string): Bookmark[] {
    const before = this.bookmarks.length;
    this.bookmarks = this.bookmarks.filter((bookmark) => bookmark.url !== url);
    return this.bookmarks.length === before ? this.list() : this.commit();
  }

  update(id: string, changes: { title?: string; url?: string }): Bookmark[] {
    const bookmark = this.bookmarks.find((entry) => entry.id === id);
    if (!bookmark) return this.list();
    if (typeof changes.url === 'string' && isBookmarkable(changes.url.trim())) bookmark.url = changes.url.trim();
    if (typeof changes.title === 'string') bookmark.title = cleanTitle(changes.title, bookmark.url);
    return this.commit();
  }

  move(id: string, toIndex: number): Bookmark[] {
    const from = this.bookmarks.findIndex((entry) => entry.id === id);
    if (from === -1) return this.list();
    const [bookmark] = this.bookmarks.splice(from, 1);
    const target = Math.min(Math.max(Math.round(toIndex), 0), this.bookmarks.length);
    this.bookmarks.splice(target, 0, bookmark!);
    return this.commit();
  }

  flush(): void {
    this.store.flush();
  }

  private commit(): Bookmark[] {
    this.store.save({ version: 1, bookmarks: this.bookmarks });
    const snapshot = this.list();
    for (const listener of this.listeners) listener(snapshot);
    return snapshot;
  }
}
