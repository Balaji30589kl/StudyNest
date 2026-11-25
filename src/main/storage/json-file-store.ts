import fs from 'node:fs';
import path from 'node:path';

/**
 * Small JSON persistence helper for main-process services: validated loads,
 * debounced saves, and atomic write-then-rename so a crash never leaves a
 * half-written file.
 */
export class JsonFileStore<T> {
  private pending: T | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly filePath: string,
    private readonly parse: (raw: unknown) => T,
    private readonly debounceMs = 500
  ) {}

  load(): T {
    try {
      return this.parse(JSON.parse(fs.readFileSync(this.filePath, 'utf-8')));
    } catch {
      return this.parse(undefined);
    }
  }

  save(data: T): void {
    this.pending = data;
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.debounceMs);
    }
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending === null) {
      return;
    }

    const data = this.pending;
    this.pending = null;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tempPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(data), 'utf-8');
      fs.renameSync(tempPath, this.filePath);
    } catch (error) {
      console.error(`[studynest] failed to persist ${path.basename(this.filePath)}`, error);
    }
  }
}
