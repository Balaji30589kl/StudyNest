import fs from 'node:fs';
import path from 'node:path';
import type { PolicySnapshot } from '../../shared/ipc.js';
import { FALLBACK_POLICY, sanitizeStudyPolicy, StudyPolicy } from '../../shared/study-policy.js';

type PolicySource = PolicySnapshot['source'];

export type PolicyServiceDeps = {
  /** Folder with blocklist.json, allowlist.json, classification.json shipped with the app. */
  bundledDir: string;
  /** Where the last policy downloaded from the gateway is cached. */
  cacheFile: string;
  /** When set, only this folder is used (development and tests). */
  overrideDir?: string | null;
  getGatewayUrl: () => string;
  getToken?: () => string | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
  log?: (level: 'info' | 'warn', message: string, data?: Record<string, unknown>) => void;
};

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return undefined;
  }
}

export function loadPolicyDir(dir: string): StudyPolicy | null {
  const block = readJson(path.join(dir, 'blocklist.json'));
  const allow = readJson(path.join(dir, 'allowlist.json'));
  const classification = readJson(path.join(dir, 'classification.json'));
  const focus = readJson(path.join(dir, 'focus.json'));
  if (block === undefined && allow === undefined) {
    return null;
  }
  return sanitizeStudyPolicy({ block, allow, classification, focus }, FALLBACK_POLICY);
}

/**
 * Owns the Study Mode rules. They come from backend files, never from the
 * user: the copy bundled with the app, replaced by the gateway's copy when it
 * is reachable (cached for offline use).
 */
export class PolicyService {
  private policy: StudyPolicy;
  private source: PolicySource;
  private version: string | null = null;
  private updatedAt: number | null = null;
  private lastError: string | null = null;
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: PolicyServiceDeps) {
    this.now = deps.now ?? Date.now;

    if (deps.overrideDir) {
      this.policy = loadPolicyDir(deps.overrideDir) ?? FALLBACK_POLICY;
      this.source = 'override';
      return;
    }

    const cached = readJson(deps.cacheFile) as { policy?: unknown; version?: string; updatedAt?: number } | undefined;
    if (cached && typeof cached.policy === 'object' && cached.policy !== null) {
      this.policy = sanitizeStudyPolicy(cached.policy as Record<string, unknown>, loadPolicyDir(deps.bundledDir) ?? FALLBACK_POLICY);
      this.source = 'gateway-cache';
      this.version = typeof cached.version === 'string' ? cached.version : null;
      this.updatedAt = typeof cached.updatedAt === 'number' ? cached.updatedAt : null;
      return;
    }

    const bundled = loadPolicyDir(deps.bundledDir);
    this.policy = bundled ?? FALLBACK_POLICY;
    this.source = bundled ? 'bundled' : 'built-in';
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getPolicy(): StudyPolicy {
    return this.policy;
  }

  getSnapshot(): PolicySnapshot {
    return {
      source: this.source,
      version: this.version,
      updatedAt: this.updatedAt,
      blockRules: this.policy.block.length,
      allowRules: this.policy.allow.length,
      aiEnabled: this.policy.classification.enabled,
      lastError: this.lastError
    };
  }

  /** Refreshes from the gateway now and then every `hours`. No-op in override mode. */
  startRefreshing(hours: number): void {
    if (this.deps.overrideDir) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), Math.max(1, hours) * 60 * 60 * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async refresh(): Promise<boolean> {
    if (this.deps.overrideDir) return false;
    const base = this.deps.getGatewayUrl().replace(/\/+$/, '');
    const token = this.deps.getToken?.() ?? null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await (this.deps.fetchImpl ?? fetch)(`${base}/v1/policy`, {
        signal: controller.signal,
        headers: token ? { authorization: `Bearer ${token}` } : {}
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as Record<string, unknown>;
      const next = sanitizeStudyPolicy(body, this.policy);
      if (next.block.length === 0 && next.allow.length === 0) throw new Error('Gateway returned an empty policy.');
      const version = typeof body.version === 'string' ? body.version : null;
      const changed = JSON.stringify(next) !== JSON.stringify(this.policy);
      this.policy = next;
      this.source = 'gateway';
      this.version = version;
      this.updatedAt = this.now();
      this.lastError = null;
      try {
        fs.mkdirSync(path.dirname(this.deps.cacheFile), { recursive: true });
        fs.writeFileSync(this.deps.cacheFile, JSON.stringify({ policy: next, version, updatedAt: this.updatedAt }));
      } catch {
        // Caching is best effort.
      }
      this.deps.log?.('info', 'policy refreshed from gateway', { version, changed, block: next.block.length, allow: next.allow.length });
      this.emit();
      return changed;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.deps.log?.('warn', 'policy refresh failed; keeping current rules', { error: this.lastError, source: this.source });
      this.emit();
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
