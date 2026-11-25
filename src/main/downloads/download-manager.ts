import { DownloadItem, Session, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { DownloadEntry } from '../../shared/ipc.js';

const MAX_ENTRIES = 50;
const PROGRESS_THROTTLE_MS = 250;

/**
 * Tracks downloads for the session. Electron's default save dialog is kept so
 * the user always chooses where a file goes; this adds a visible list with
 * progress, cancel, open, and show-in-folder.
 */
export class DownloadManager {
  private readonly entries = new Map<string, DownloadEntry>();
  private readonly items = new Map<string, DownloadItem>();
  private readonly listeners = new Set<() => void>();
  private lastEmit = 0;
  private pendingEmit: ReturnType<typeof setTimeout> | null = null;

  constructor(session: Session, private readonly log: (message: string, data?: Record<string, unknown>) => void = () => undefined) {
    session.on('will-download', (_event, item) => this.track(item));
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): DownloadEntry[] {
    return [...this.entries.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  cancel(id: string): void {
    const item = this.items.get(id);
    if (item && item.getState() === 'progressing') {
      item.cancel();
    }
  }

  async open(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (entry?.state === 'completed' && entry.savePath) {
      const error = await shell.openPath(entry.savePath);
      if (error) {
        this.log('open download failed', { error });
      }
    }
  }

  showInFolder(id: string): void {
    const entry = this.entries.get(id);
    if (entry?.savePath) {
      shell.showItemInFolder(entry.savePath);
    }
  }

  /** Removes finished entries from the list (files are not deleted). */
  clearFinished(): void {
    for (const [id, entry] of this.entries) {
      if (entry.state !== 'progressing') {
        this.entries.delete(id);
        this.items.delete(id);
      }
    }
    this.emit(true);
  }

  private track(item: DownloadItem): void {
    const id = randomUUID();
    let host = '';
    try {
      host = new URL(item.getURL()).hostname;
    } catch {
      host = '';
    }

    const entry: DownloadEntry = {
      id,
      filename: item.getFilename(),
      host,
      receivedBytes: 0,
      totalBytes: item.getTotalBytes(),
      state: 'progressing',
      savePath: null,
      startedAt: Date.now()
    };
    this.entries.set(id, entry);
    this.items.set(id, item);
    this.trim();
    this.emit(true);

    item.on('updated', (_event, state) => {
      entry.receivedBytes = item.getReceivedBytes();
      entry.totalBytes = item.getTotalBytes();
      entry.savePath = item.getSavePath() || entry.savePath;
      entry.filename = entry.savePath ? path.basename(entry.savePath) : entry.filename;
      entry.state = state === 'interrupted' ? 'interrupted' : 'progressing';
      this.emit(false);
    });

    item.once('done', (_event, state) => {
      entry.receivedBytes = item.getReceivedBytes();
      entry.savePath = item.getSavePath() || entry.savePath;
      entry.filename = entry.savePath ? path.basename(entry.savePath) : entry.filename;
      entry.state = state;
      this.items.delete(id);
      this.log('download finished', { state, host });
      this.emit(true);
    });
  }

  private trim(): void {
    const finished = this.getSnapshot().filter((entry) => entry.state !== 'progressing');
    while (this.entries.size > MAX_ENTRIES && finished.length > 0) {
      const oldest = finished.pop();
      if (oldest) {
        this.entries.delete(oldest.id);
      }
    }
  }

  /** Progress events are frequent; throttle them, but always send state changes. */
  private emit(immediate: boolean): void {
    const now = Date.now();
    if (!immediate && now - this.lastEmit < PROGRESS_THROTTLE_MS) {
      if (!this.pendingEmit) {
        this.pendingEmit = setTimeout(() => {
          this.pendingEmit = null;
          this.emit(true);
        }, PROGRESS_THROTTLE_MS);
      }
      return;
    }
    this.lastEmit = now;
    for (const listener of this.listeners) {
      listener();
    }
  }
}
