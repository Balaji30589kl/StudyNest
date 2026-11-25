import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { ProviderPrediction, sanitizePageMetadata } from '../../src/shared/classification.js';
import type { Classifier } from './claude-classifier.js';
import { ClassifierError } from './claude-classifier.js';
import type { GatewayConfig } from './config.js';
import { RateLimiter, TtlCache } from './limits.js';
import type { PolicyDocument } from './policy.js';

const MAX_BODY_BYTES = 16 * 1024;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const POLICY_RELOAD_MS = 60_000;

export type GatewayDeps = {
  config: GatewayConfig;
  /** Null when no API key is configured: classify requests then return 503. */
  classifier: Classifier | null;
  loadPolicy: () => PolicyDocument;
  now?: () => number;
  log?: (message: string, data?: Record<string, unknown>) => void;
};

export type ClassifyResponse = ProviderPrediction & { model: string; cached: boolean };

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers
  });
  res.end(payload);
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  if (!(req.headers['content-type'] ?? '').includes('application/json')) {
    throw new HttpError(415, 'Expected application/json.');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, 'Request body too large.');
    }
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON.');
  }
}

function tokenMatches(header: string | undefined, expected: string): boolean {
  const provided = header?.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function clientKey(req: http.IncomingMessage): string {
  // Behind a reverse proxy, the first X-Forwarded-For address is the client.
  const forwarded = req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
}

/**
 * The StudyNest AI gateway. Endpoints:
 *   GET  /health       status (never reveals the key)
 *   GET  /v1/policy    block list, allow list and classification config
 *   POST /v1/classify  { metadata } -> { category, confidence, rationale, model, cached }
 */
export function createGatewayServer(deps: GatewayDeps): http.Server {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => undefined);
  const { config } = deps;
  const limiter = new RateLimiter(config.ratePerMinute, config.dailyCap, now);
  const cache = new TtlCache<ProviderPrediction>(20_000, CACHE_TTL_MS, now);
  const inFlight = new Map<string, Promise<ProviderPrediction>>();
  let policy = deps.loadPolicy();
  let policyLoadedAt = now();

  function currentPolicy(): PolicyDocument {
    if (now() - policyLoadedAt > POLICY_RELOAD_MS) {
      policy = deps.loadPolicy();
      policyLoadedAt = now();
    }
    return policy;
  }

  async function classify(req: http.IncomingMessage): Promise<ClassifyResponse> {
    if (config.clientToken && !tokenMatches(req.headers.authorization, config.clientToken)) {
      throw new HttpError(401, 'Missing or invalid client token.');
    }
    if (!deps.classifier) {
      throw new HttpError(503, 'The gateway has no LLM API key configured.');
    }

    const body = (await readJsonBody(req)) as { metadata?: Record<string, unknown> } | null;
    const raw = body?.metadata;
    if (!raw || typeof raw.url !== 'string' || typeof raw.host !== 'string') {
      throw new HttpError(400, 'Body must be { metadata: { url, host, ... } }.');
    }
    const metadata = sanitizePageMetadata(raw, raw.url, raw.host, typeof raw.key === 'string' ? raw.key : raw.host);
    const cacheKey = metadata.key || metadata.host;

    const cached = cache.get(cacheKey);
    if (cached) {
      return { ...cached, model: config.model, cached: true };
    }

    const refused = limiter.take(clientKey(req));
    if (refused === 'daily-cap') throw new HttpError(429, 'The gateway reached its daily request cap.');
    if (refused === 'rate-limited') throw new HttpError(429, 'Too many requests. Slow down.');

    let pending = inFlight.get(cacheKey);
    if (!pending) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.classifyTimeoutMs);
      pending = deps.classifier(metadata, controller.signal).finally(() => {
        clearTimeout(timer);
        inFlight.delete(cacheKey);
      });
      inFlight.set(cacheKey, pending);
    }

    try {
      const prediction = await pending;
      cache.set(cacheKey, prediction);
      // Hosts and categories only: page URLs and content are not logged.
      log('classified', { host: metadata.host, category: prediction.category });
      return { ...prediction, model: config.model, cached: false };
    } catch (error) {
      if (error instanceof ClassifierError) {
        log('classifier failed', { host: metadata.host, error: error.message });
        throw new HttpError(error.retryable ? 503 : 502, error.message);
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new HttpError(504, 'The LLM provider took too long.');
      }
      throw error;
    }
  }

  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://gateway');
    const route = `${req.method} ${url.pathname}`;

    void (async () => {
      try {
        if (route === 'GET /health') {
          send(res, 200, { ok: true, provider: config.provider, model: config.model, keyConfigured: Boolean(deps.classifier), usage: limiter.usage(), cacheSize: cache.size });
          return;
        }
        if (route === 'GET /v1/policy') {
          const document = currentPolicy();
          send(res, 200, document, { etag: `"${document.version}"` });
          return;
        }
        if (route === 'POST /v1/classify') {
          send(res, 200, await classify(req));
          return;
        }
        send(res, 404, { error: 'Not found.' });
      } catch (error) {
        if (error instanceof HttpError) {
          send(res, error.status, { error: error.message });
          return;
        }
        log('unexpected error', { error: error instanceof Error ? error.message : String(error) });
        send(res, 500, { error: 'Internal error.' });
      }
    })();
  });
}
