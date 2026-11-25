import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogRecord = {
  at: number;
  level: LogLevel;
  scope: string;
  message: string;
  data?: Record<string, unknown>;
};

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MAX_RECENT_PROBLEMS = 50;
/** Keys whose values are never written to logs. */
const REDACTED_KEYS = /key|token|secret|password|authorization/i;

export type LoggerOptions = {
  filePath: string | null;
  minLevel?: LogLevel;
  maxBytes?: number;
  now?: () => number;
  echo?: boolean;
};

function redact(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!data) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, REDACTED_KEYS.test(key) ? '[redacted]' : value instanceof Error ? value.message : value])
  );
}

/**
 * Structured JSON-lines logger with size-based rotation (one backup file)
 * and an in-memory ring of recent warnings and errors for diagnostics.
 * Never logs URLs or page content by convention: callers pass hosts or counts.
 */
export class Logger {
  private readonly minLevel: LogLevel;
  private readonly maxBytes: number;
  private readonly now: () => number;
  private readonly echo: boolean;
  private readonly recentProblems: LogRecord[] = [];

  constructor(private readonly options: LoggerOptions) {
    this.minLevel = options.minLevel ?? 'info';
    this.maxBytes = options.maxBytes ?? 1_000_000;
    this.now = options.now ?? Date.now;
    this.echo = options.echo ?? false;
  }

  get filePath(): string | null {
    return this.options.filePath;
  }

  scope(name: string): ScopedLogger {
    return {
      debug: (message, data) => this.write('debug', name, message, data),
      info: (message, data) => this.write('info', name, message, data),
      warn: (message, data) => this.write('warn', name, message, data),
      error: (message, data) => this.write('error', name, message, data)
    };
  }

  getRecentProblems(): LogRecord[] {
    return [...this.recentProblems].reverse();
  }

  write(level: LogLevel, scope: string, message: string, data?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) {
      return;
    }

    const record: LogRecord = { at: this.now(), level, scope, message, ...(data ? { data: redact(data) } : {}) };
    if (LEVEL_ORDER[level] >= LEVEL_ORDER.warn) {
      this.recentProblems.push(record);
      if (this.recentProblems.length > MAX_RECENT_PROBLEMS) {
        this.recentProblems.shift();
      }
    }

    if (this.echo) {
      const line = `[studynest:${scope}] ${message}`;
      if (level === 'error') console.error(line, record.data ?? '');
      else if (level === 'warn') console.warn(line, record.data ?? '');
      else console.log(line, record.data ?? '');
    }

    const filePath = this.options.filePath;
    if (!filePath) {
      return;
    }
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      this.rotateIfNeeded(filePath);
      fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf-8');
    } catch {
      // Logging must never take the app down.
    }
  }

  private rotateIfNeeded(filePath: string): void {
    try {
      if (fs.statSync(filePath).size >= this.maxBytes) {
        fs.renameSync(filePath, `${filePath}.1`);
      }
    } catch {
      // File does not exist yet.
    }
  }
}

export type ScopedLogger = {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
};
