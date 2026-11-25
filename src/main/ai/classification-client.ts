import type { Classification, PageMetadata, ProviderPrediction } from '../../shared/classification.js';
import { isPageCategory, sanitizePageMetadata } from '../../shared/classification.js';
import type { AiStateSnapshot, AiStats } from '../../shared/ipc.js';
import { ClassificationPolicy, classificationKey, getPolicyHost } from '../../shared/study-policy.js';
import type { MetadataResult } from './page-metadata.js';
import type { ClassificationProvider } from './provider.js';

export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Fallback answers are retried sooner so the real classifier gets another chance. */
export const FALLBACK_CACHE_TTL_MS = 2 * 60 * 1000;
/** Offline guesses that could not identify the page are retried on the next visit or reload. */
export const UNCLEAR_FALLBACK_TTL_MS = 15 * 1000;
export const MAX_CACHE_ENTRIES = 2000;
/** A little longer than the gateway's own budget (9 s), so its answer is never thrown away. */
const DEFAULT_TIMEOUT_MS = 10_000;
const RECENT_LIMIT = 12;

export type PersistedAiData = { version: number; cache: Classification[] };

export interface AiStore {
  load(): PersistedAiData;
  save(data: PersistedAiData): void;
  flush(): void;
}

export type ClassificationClientDeps = {
  store: AiStore;
  /** Primary classifier (the gateway). */
  primary: ClassificationProvider;
  /** Offline fallback (keyword rules). */
  fallback: ClassificationProvider;
  fetchMetadata: (url: string, host: string, key: string) => Promise<MetadataResult>;
  getPolicy: () => ClassificationPolicy;
  getGatewayUrl: () => string;
  now?: () => number;
  timeoutMs?: number;
};

function isClassification(value: unknown): value is Classification {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.key === 'string' &&
    typeof entry.host === 'string' &&
    isPageCategory(entry.category) &&
    typeof entry.confidence === 'number' &&
    typeof entry.providerId === 'string' &&
    typeof entry.classifiedAt === 'number'
  );
}

export function parseAiData(raw: unknown): PersistedAiData {
  const candidate = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    version: 2,
    cache: Array.isArray(candidate.cache) ? candidate.cache.filter(isClassification).slice(-MAX_CACHE_ENTRIES) : []
  };
}

function emptyStats(): AiStats {
  return { checks: 0, cacheHits: 0, gatewayCalls: 0, fallbacks: 0, errors: 0, lastError: null };
}

type ChangeListener = () => void;

/**
 * Classifies pages before they render. For a URL it fetches the page's
 * metadata, asks the gateway (falling back to offline rules), and caches the
 * answer per classification key (per site, or per video on YouTube).
 * Predictions only: Study Mode policy decides what happens with them.
 */
export class ClassificationClient {
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly cache = new Map<string, Classification>();
  private readonly inFlight = new Map<string, Promise<Classification>>();
  private readonly listeners = new Set<ChangeListener>();
  private stats: AiStats = emptyStats();
  private gatewayStatus: AiStateSnapshot['gateway']['status'] = 'unknown';

  constructor(private readonly deps: ClassificationClientDeps) {
    this.now = deps.now ?? Date.now;
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    for (const entry of deps.store.load().cache) {
      this.cache.set(entry.key, entry);
    }
  }

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  keyFor(url: string): string | null {
    return classificationKey(url, this.deps.getPolicy());
  }

  /** Synchronous cache lookup used by the navigation guard. Never fetches. */
  peek(url: string): Classification | null {
    const key = this.keyFor(url);
    return key ? this.getFresh(key) : null;
  }

  /** Classifies a page, de-duplicating concurrent requests for the same key. */
  classify(url: string): Promise<Classification> {
    const key = this.keyFor(url);
    const host = getPolicyHost(url);
    if (!key || !host) {
      return Promise.reject(new Error('Only web pages can be classified.'));
    }
    this.stats.checks += 1;
    const cached = this.getFresh(key);
    if (cached) {
      this.stats.cacheHits += 1;
      return Promise.resolve(cached);
    }
    const pending = this.inFlight.get(key);
    if (pending) {
      return pending;
    }
    const request = this.run(url, host, key).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, request);
    return request;
  }

  getSnapshot(): AiStateSnapshot {
    return {
      gateway: { url: this.deps.getGatewayUrl(), status: this.gatewayStatus },
      stats: { ...this.stats },
      cacheSize: this.cache.size,
      recentClassifications: [...this.cache.values()].sort((a, b) => b.classifiedAt - a.classifiedAt).slice(0, RECENT_LIMIT)
    };
  }

  clearCache(): AiStateSnapshot {
    this.cache.clear();
    this.stats = emptyStats();
    this.commit();
    return this.getSnapshot();
  }

  flush(): void {
    this.deps.store.flush();
  }

  private async run(url: string, host: string, key: string): Promise<Classification> {
    const fetched = await this.deps.fetchMetadata(url, host, key);

    if (fetched.kind === 'not-html') {
      // Documents and files (PDF notes, images) are not distractions to judge.
      return this.remember({ category: 'reference', confidence: 1, rationale: `Not a web page (${fetched.contentType || 'file'}).` }, url, host, key, 'content-type', false);
    }

    const metadata: PageMetadata =
      fetched.kind === 'html' ? fetched.metadata : sanitizePageMetadata({}, url, host, key);

    let prediction: ProviderPrediction;
    let providerId = this.deps.primary.id;
    let fallback = false;
    try {
      if (fetched.kind !== 'html') {
        throw new Error(`Page metadata unavailable: ${fetched.reason}`);
      }
      if (!this.deps.primary.isAvailable()) {
        throw new Error('Gateway is not configured.');
      }
      this.stats.gatewayCalls += 1;
      prediction = await this.withTimeout((signal) => this.deps.primary.classify(metadata, signal));
      this.gatewayStatus = 'online';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.stats.errors += 1;
      this.stats.lastError = message;
      if (fetched.kind === 'html') {
        this.gatewayStatus = 'offline';
      }
      this.stats.fallbacks += 1;
      prediction = await this.deps.fallback.classify(metadata, new AbortController().signal);
      providerId = this.deps.fallback.id;
      fallback = true;
    }

    return this.remember(prediction, url, host, key, providerId, fallback);
  }

  private remember(prediction: ProviderPrediction, url: string, host: string, key: string, providerId: string, fallback: boolean): Classification {
    void url;
    const classification: Classification = { ...prediction, host, key, providerId, fallback, classifiedAt: this.now() };
    this.cache.delete(key);
    this.cache.set(key, classification);
    while (this.cache.size > MAX_CACHE_ENTRIES) {
      this.cache.delete(this.cache.keys().next().value as string);
    }
    this.commit();
    return classification;
  }

  private async withTimeout<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await Promise.race([
        run(controller.signal),
        new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Gateway timed out.')), { once: true }))
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private getFresh(key: string): Classification | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    const ttl = !entry.fallback ? CACHE_TTL_MS : entry.category === 'other' ? UNCLEAR_FALLBACK_TTL_MS : FALLBACK_CACHE_TTL_MS;
    if (this.now() - entry.classifiedAt > ttl) {
      this.cache.delete(key);
      return null;
    }
    return entry;
  }

  private commit(): void {
    this.deps.store.save({ version: 2, cache: [...this.cache.values()] });
    for (const listener of this.listeners) listener();
  }
}
