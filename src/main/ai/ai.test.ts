import { describe, expect, it, vi } from 'vitest';
import type { PageMetadata, ProviderPrediction } from '../../shared/classification.js';
import { sanitizePageMetadata } from '../../shared/classification.js';
import { DEFAULT_CLASSIFICATION_POLICY } from '../../shared/study-policy.js';
import { ClassificationClient, FALLBACK_CACHE_TTL_MS, parseAiData, PersistedAiData } from './classification-client.js';
import { GatewayProvider } from './gateway-provider.js';
import { fetchPageMetadata, MetadataResult, parseHtmlMetadata, searchPageMetadata } from './page-metadata.js';
import type { ClassificationProvider } from './provider.js';
import { classifyByRules, RuleBasedProvider } from './rule-based-provider.js';

const YOUTUBE_LECTURE = `<!doctype html><html lang="en"><head>
<title>MIT 18.06 Linear Algebra, Lecture 1 - YouTube</title>
<meta name="title" content="Lecture 1: The Geometry of Linear Equations">
<meta name="description" content="MIT 18.06 Linear Algebra, Spring 2005. Instructor: Gilbert Strang.">
<meta name="keywords" content="linear algebra, mit, lecture">
<meta property="og:site_name" content="YouTube">
<meta property="og:title" content="Lecture 1: The Geometry of Linear Equations">
<meta property="og:type" content="video.other">
<meta property="og:video:tag" content="matrices">
<meta itemprop="genre" content="Education">
</head><body><script>var ytInitialData = {"huge": true};</script><h1>Lecture 1 &amp; intro</h1><p>Watch the lecture</p></body></html>`;

describe('parseHtmlMetadata', () => {
  it('extracts title, description, genre, tags and headings without rendering', () => {
    const meta = parseHtmlMetadata(YOUTUBE_LECTURE);
    expect(meta).toMatchObject({
      title: 'Lecture 1: The Geometry of Linear Equations',
      description: 'MIT 18.06 Linear Algebra, Spring 2005. Instructor: Gilbert Strang.',
      siteName: 'YouTube',
      ogType: 'video.other',
      genre: 'Education',
      lang: 'en',
      headings: ['Lecture 1 & intro']
    });
    expect(meta.keywords).toEqual(['matrices', 'linear algebra', 'mit', 'lecture']);
    expect(meta.textSample).not.toContain('ytInitialData');
  });

  it('falls back to <title> and copes with empty documents', () => {
    expect(parseHtmlMetadata('<html><head><title>Plain &quot;page&quot;</title></head></html>').title).toBe('Plain "page"');
    expect(parseHtmlMetadata('')).toMatchObject({ title: '', description: '', keywords: [] });
  });
});

describe('fetchPageMetadata', () => {
  const html = (body: string, type = 'text/html; charset=utf-8') =>
    vi.fn(async () => new Response(body, { headers: { 'content-type': type } })) as unknown as typeof fetch;

  it('returns sanitized metadata for HTML pages', async () => {
    const result = await fetchPageMetadata('https://www.youtube.com/watch?v=1', 'youtube.com', 'youtube.com/watch?v=1', { fetchImpl: html(YOUTUBE_LECTURE) });
    expect(result.kind).toBe('html');
    if (result.kind === 'html') {
      expect(result.metadata).toMatchObject({ key: 'youtube.com/watch?v=1', genre: 'Education', host: 'youtube.com' });
    }
  });

  it('reports non-HTML content and unreachable sites', async () => {
    expect(await fetchPageMetadata('https://x.test/notes.pdf', 'x.test', 'x.test', { fetchImpl: html('%PDF', 'application/pdf') })).toEqual({
      kind: 'not-html',
      contentType: 'application/pdf'
    });
    const failing = vi.fn(async () => {
      throw new Error('ENOTFOUND');
    }) as unknown as typeof fetch;
    expect(await fetchPageMetadata('https://x.test', 'x.test', 'x.test', { fetchImpl: failing })).toMatchObject({ kind: 'unreachable' });
  });

  /** Routes the page request and the oEmbed request to separate fake responses. */
  function routed(page: () => Response, oembed: () => Response) {
    return vi.fn(async (input: string | URL | Request) => (String(input).includes('/oembed') ? oembed() : page())) as unknown as typeof fetch;
  }
  function redirected(body: string, status: number, finalUrl: string) {
    const response = new Response(body, { status, headers: { 'content-type': 'text/html' } });
    Object.defineProperty(response, 'url', { value: finalUrl });
    return response;
  }
  const OEMBED = () =>
    new Response(JSON.stringify({ title: 'Learn Python - Full Course for Beginners', author_name: 'freeCodeCamp.org', provider_name: 'YouTube' }), {
      headers: { 'content-type': 'application/json' }
    });

  it('does not mistake a bot-check page for the video, and uses oEmbed instead', async () => {
    const captcha = () => redirected('<html><head><title>https://www.youtube.com/watch?v=1</title></head></html>', 429, 'https://www.google.com/sorry/index?continue=x');
    const result = await fetchPageMetadata('https://www.youtube.com/watch?v=1', 'youtube.com', 'youtube.com/watch?v=1', { fetchImpl: routed(captcha, OEMBED) });
    expect(result).toMatchObject({
      kind: 'html',
      metadata: { title: 'Learn Python - Full Course for Beginners', siteName: 'YouTube', description: 'Video by freeCodeCamp.org on YouTube.', keywords: ['freeCodeCamp.org'] }
    });
  });

  it('treats consent walls as refused and reports refused pages without oEmbed as unreachable', async () => {
    const consent = () => redirected('<html><head><title>Before you continue</title></head></html>', 200, 'https://consent.youtube.com/m?continue=x');
    const viaConsent = await fetchPageMetadata('https://www.youtube.com/watch?v=2', 'youtube.com', 'youtube.com/watch?v=2', { fetchImpl: routed(consent, OEMBED) });
    expect(viaConsent).toMatchObject({ kind: 'html', metadata: { title: 'Learn Python - Full Course for Beginners' } });

    const forbidden = vi.fn(async () => new Response('denied', { status: 403, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch;
    expect(await fetchPageMetadata('https://x.test', 'x.test', 'x.test', { fetchImpl: forbidden })).toEqual({
      kind: 'unreachable',
      reason: 'The site refused the metadata request (HTTP 403).'
    });
  });

  it('describes a YouTube search by its query without fetching the results page', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await fetchPageMetadata('https://www.youtube.com/results?search_query=funny++comedy%20videos', 'youtube.com', 'youtube.com/results?search_query=funny++comedy+videos', { fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      kind: 'html',
      metadata: { title: 'YouTube search: funny comedy videos', siteName: 'YouTube', ogType: 'search', keywords: ['funny comedy videos'], key: 'youtube.com/results?search_query=funny++comedy+videos' }
    });
    expect(searchPageMetadata('https://www.youtube.com/results', 'youtube.com')).toMatchObject({ title: 'YouTube search', keywords: [] });
    expect(searchPageMetadata('https://www.youtube.com/watch?v=1', 'youtube.com')).toBeNull();
    expect(searchPageMetadata('https://example.com/results?search_query=x', 'example.com')).toBeNull();
  });

  it('keeps the page title when the page loads and adds the channel from oEmbed', async () => {
    const result = await fetchPageMetadata('https://www.youtube.com/watch?v=1', 'youtube.com', 'youtube.com/watch?v=1', {
      fetchImpl: routed(() => new Response(YOUTUBE_LECTURE, { headers: { 'content-type': 'text/html' } }), OEMBED)
    });
    expect(result).toMatchObject({ kind: 'html', metadata: { title: 'Lecture 1: The Geometry of Linear Equations', genre: 'Education' } });
    if (result.kind === 'html') expect(result.metadata.keywords).toContain('freeCodeCamp.org');
  });
});

describe('rule-based fallback', () => {
  it('recognises sports offline, e.g. cricket highlights', () => {
    const base: PageMetadata = { url: 'u', host: 'youtube.com', key: 'k', genre: '', title: '', description: '', keywords: [], headings: [], siteName: 'YouTube', ogType: '', lang: 'en', textSample: '' };
    for (const title of ['Pakistan vs Nepal Highlights | Shaheens Win by 96 Runs | Asia Cup Rising Stars 2026', "Highlights | Match 11 | India 'A' v UAE | DP World Men's Asia Cup Rising Stars 2026"]) {
      expect(classifyByRules({ ...base, title, description: 'Video by Asian Cricket Council on YouTube.' }).category).toBe('sports');
    }
    expect(classifyByRules({ ...base, title: 'Dynamic programming tutorial for beginners', description: 'Video by freeCodeCamp.org on YouTube.' }).category).toBe('study');
  });

  it('judges offline searches by their query', () => {
    const search = (query: string) => classifyByRules(sanitizePageMetadata(searchPageMetadata(`https://www.youtube.com/results?search_query=${query}`, 'youtube.com'), 'u', 'youtube.com'));
    expect(search('linear+algebra+lecture').category).toBe('study');
    expect(search('funny+comedy+videos').category).toBe('entertainment');
  });

  it('uses the platform genre as a strong signal', () => {
    const base: PageMetadata = { url: 'u', host: 'youtube.com', key: 'k', genre: '', title: 'Video', description: '', keywords: [], headings: [], siteName: 'YouTube', ogType: '', lang: 'en', textSample: '' };
    expect(classifyByRules({ ...base, genre: 'Education', title: 'Lecture 3: recursion' }).category).toBe('study');
    expect(classifyByRules({ ...base, genre: 'Comedy', title: 'Funny prank compilation #shorts' }).category).toBe('entertainment');
  });
});

class MemoryAiStore {
  data: PersistedAiData = parseAiData(undefined);
  load() {
    return structuredClone(this.data);
  }
  save(data: PersistedAiData) {
    this.data = structuredClone(data);
  }
  flush() {}
}

function provider(id: string, impl: () => Promise<ProviderPrediction>, available = true) {
  const classify = vi.fn(impl);
  return { provider: { id, label: id, isAvailable: () => available, classify } as ClassificationProvider, classify };
}

function createClient(options: { primary?: ClassificationProvider; fetchMetadata?: (url: string, host: string, key: string) => Promise<MetadataResult> } = {}) {
  let now = 1000;
  const gateway = provider('gateway', async () => ({ category: 'entertainment', confidence: 0.9, rationale: 'Comedy.' }));
  const fetchMetadata = vi.fn(
    options.fetchMetadata ??
      (async (url: string, host: string, key: string): Promise<MetadataResult> => ({
        kind: 'html',
        metadata: { url, host, key, genre: 'Comedy', title: 'Prank compilation', description: '', keywords: [], headings: [], siteName: '', ogType: '', lang: 'en', textSample: '' }
      }))
  );
  const client = new ClassificationClient({
    store: new MemoryAiStore(),
    primary: options.primary ?? gateway.provider,
    fallback: new RuleBasedProvider(),
    fetchMetadata,
    getPolicy: () => ({ ...DEFAULT_CLASSIFICATION_POLICY, perPageHosts: ['youtube.com'] }),
    getGatewayUrl: () => 'http://gateway.test',
    now: () => now,
    timeoutMs: 200
  });
  return { client, gateway, fetchMetadata, advance: (ms: number) => (now += ms) };
}

describe('ClassificationClient', () => {
  it('classifies through the gateway and caches per video', async () => {
    const { client, gateway, fetchMetadata } = createClient();
    const first = await client.classify('https://www.youtube.com/watch?v=a&t=10');
    expect(first).toMatchObject({ category: 'entertainment', providerId: 'gateway', key: 'youtube.com/watch?v=a', fallback: false });
    expect(client.peek('https://youtube.com/watch?v=a')).toEqual(first);
    expect(client.peek('https://youtube.com/watch?v=b')).toBeNull();

    await client.classify('https://www.youtube.com/watch?v=a');
    expect(gateway.classify).toHaveBeenCalledTimes(1);
    expect(fetchMetadata).toHaveBeenCalledTimes(1);
    expect(client.getSnapshot()).toMatchObject({ gateway: { status: 'online' }, stats: { checks: 2, cacheHits: 1, gatewayCalls: 1 } });
  });

  it('de-duplicates concurrent checks of the same page', async () => {
    const { client, gateway } = createClient();
    await Promise.all([client.classify('https://youtube.com/watch?v=z'), client.classify('https://youtube.com/watch?v=z')]);
    expect(gateway.classify).toHaveBeenCalledTimes(1);
  });

  it('falls back to offline rules when the gateway fails, and retries later', async () => {
    const down = provider('gateway', async () => {
      throw new Error('Gateway unreachable.');
    });
    const { client, advance } = createClient({ primary: down.provider });
    const result = await client.classify('https://youtube.com/watch?v=c');
    expect(result).toMatchObject({ providerId: 'rule-based', fallback: true, category: 'entertainment' });
    expect(client.getSnapshot()).toMatchObject({ gateway: { status: 'offline' }, stats: { fallbacks: 1, lastError: 'Gateway unreachable.' } });
    advance(FALLBACK_CACHE_TTL_MS + 1);
    expect(client.peek('https://youtube.com/watch?v=c')).toBeNull();
  });

  it('times out a slow gateway', async () => {
    const slow = provider('gateway', () => new Promise(() => undefined));
    const { client } = createClient({ primary: slow.provider });
    expect((await client.classify('https://youtube.com/watch?v=s')).fallback).toBe(true);
    expect(client.getSnapshot().stats.lastError).toBe('Gateway timed out.');
  });

  it('lets documents through and handles unreachable pages offline', async () => {
    const pdf = createClient({ fetchMetadata: async () => ({ kind: 'not-html', contentType: 'application/pdf' }) });
    expect(await pdf.client.classify('https://notes.test/ch1.pdf')).toMatchObject({ category: 'reference', providerId: 'content-type' });
    expect(pdf.gateway.classify).not.toHaveBeenCalled();

    const offline = createClient({ fetchMetadata: async () => ({ kind: 'unreachable', reason: 'ENOTFOUND' }) });
    expect(await offline.client.classify('https://gone.test')).toMatchObject({ providerId: 'rule-based', fallback: true });
    expect(offline.gateway.classify).not.toHaveBeenCalled();
  });
});

describe('GatewayProvider', () => {
  const metadata: PageMetadata = { url: 'https://y.test', host: 'y.test', key: 'y.test', genre: '', title: 't', description: '', keywords: [], headings: [], siteName: '', ogType: '', lang: '', textSample: '' };

  it('posts metadata with the optional token and validates the answer', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ category: 'study', confidence: 0.8, rationale: 'r', model: 'm', cached: false }));
    const gateway = new GatewayProvider({ getUrl: () => 'http://gw.test/', getToken: () => 'tok', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(gateway.classify(metadata, new AbortController().signal)).resolves.toEqual({ category: 'study', confidence: 0.8, rationale: 'r' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://gw.test/v1/classify');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(String(init.body)).metadata.key).toBe('y.test');
  });

  it('surfaces gateway errors', async () => {
    const limited = new GatewayProvider({
      getUrl: () => 'http://gw.test',
      fetchImpl: (async () => Response.json({ error: 'Too many requests. Slow down.' }, { status: 429 })) as unknown as typeof fetch
    });
    await expect(limited.classify(metadata, new AbortController().signal)).rejects.toThrow('Too many requests');
    expect(new GatewayProvider({ getUrl: () => 'not a url' }).isAvailable()).toBe(false);
  });
});
