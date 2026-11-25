import fs from 'node:fs/promises';
import path from 'node:path';
import type { SyncDocument } from './sync-engine.js';

/**
 * Moves sync documents between this device and a shared location. A future
 * cloud service only needs to implement this interface (for example an
 * authenticated HTTPS transport); the merge logic stays unchanged.
 */
export interface SyncTransport {
  readonly kind: string;
  describe(): string;
  /** Returns the raw (untrusted) document, or null if none exists yet. */
  read(): Promise<unknown | null>;
  write(document: SyncDocument): Promise<void>;
}

export const SYNC_FILE_NAME = 'studynest-sync.json';

/**
 * Syncs through a folder the user already keeps in sync (OneDrive, Dropbox,
 * iCloud Drive, a network share). Writes are atomic: temp file, then rename.
 */
export class FolderSyncTransport implements SyncTransport {
  readonly kind = 'folder';
  private readonly filePath: string;

  constructor(private readonly folder: string) {
    this.filePath = path.join(folder, SYNC_FILE_NAME);
  }

  describe(): string {
    return this.filePath;
  }

  async read(): Promise<unknown | null> {
    let contents: string;
    try {
      contents = await fs.readFile(this.filePath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
    return JSON.parse(contents) as unknown;
  }

  async write(document: SyncDocument): Promise<void> {
    await fs.mkdir(this.folder, { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(document, null, 2), 'utf-8');
    await fs.rename(tempPath, this.filePath);
  }
}
