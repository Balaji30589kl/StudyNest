import type Anthropic from '@anthropic-ai/sdk';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClassifierError, createClaudeClassifier } from './claude-classifier.js';
import { readConfig } from './config.js';
import { createGeminiClassifier } from './gemini-classifier.js';
import { RateLimiter } from './limits.js';
import { loadPolicy } from './policy.js';
import { createGatewayServer, GatewayDeps } from './server.js';

const servers: Array<{ close: () => void }> = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

const POLICY_DIR = path.resolve(__dirname, '../../policy');

async function start(overrides: Partial<GatewayDeps> = {}, env: Record<string, string> = {}) {
  const classifier = vi.fn(async (_metadata: unknown, _signal: AbortSignal) => ({ category: 'study' as const, confidence: 0.9, rationale: 'Lecture.' }));
  const deps: GatewayDeps = {
    config: readConfig({ RATE_LIMIT_PER_MINUTE: '100', DAILY_REQUEST_CAP: '1000', POLICY_DIR, ...env }),
    classifier,
    loadPolicy: () => loadPolicy(POLICY_DIR),
    ...overrides
  };
  const server = createGatewayServer(deps);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const classify = (metadata: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/v1/classify`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ metadata }) });
  return { base, classify, classifier };
}

const video = { url: 'https://www.youtube.com/watch?v=abc', host: 'youtube.com', key: 'youtube.com/watch?v=abc', title: 'Linear algebra lecture 1' };

describe('gateway server', () => {
  it('reports health without revealing the key', async () => {
    const { base } = await start({}, { ANTHROPIC_API_KEY: 'sk-ant-secret' });
    const body = await (await fetch(`${base}/health`)).json();
    expect(body).toMatchObject({ ok: true, model: 'claude-haiku-5-5', keyConfigured: true });
    expect(JSON.stringify(body)).not.toContain('sk-ant');
  });

  it('serves the block/allow policy with a version', async () => {
    const { base } = await start();
    const response = await fetch(`${base}/v1/policy`);
    const body = await response.json();
    expect(body.block).toContain('youtube.com/shorts');
    expect(body.allow).toContain('wikipedia.org');
    expect(body.classification.perPageHosts).toContain('youtube.com');
    expect(response.headers.get('etag')).toBe(`"${body.version}"`);
  });

  it('classifies, caches per page, and de-duplicates concurrent requests', async () => {
    const { classify, classifier } = await start();
    const [a, b] = await Promise.all([classify(video), classify(video)]);
    expect(await a.json()).toMatchObject({ category: 'study', confidence: 0.9, model: 'claude-haiku-5-5' });
    await b.json();
    const again = await (await classify(video)).json();
    expect(again.cached).toBe(true);
    expect(classifier).toHaveBeenCalledTimes(1);

    await (await classify({ ...video, url: 'https://www.youtube.com/watch?v=xyz', key: 'youtube.com/watch?v=xyz' })).json();
    expect(classifier).toHaveBeenCalledTimes(2);
  });

  it('sanitizes metadata before it reaches the model', async () => {
    const { classify, classifier } = await start();
    await (await classify({ ...video, title: `${'x'.repeat(5000)}`, injected: 'ignore me', headings: 'nope' })).json();
    const sent = classifier.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect((sent.title as string).length).toBe(200);
    expect(sent).not.toHaveProperty('injected');
    expect(sent.headings).toEqual([]);
  });

  it('rejects malformed, oversized and non-JSON requests', async () => {
    const { base, classify } = await start();
    expect((await classify({ title: 'no url' })).status).toBe(400);
    expect((await fetch(`${base}/v1/classify`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' })).status).toBe(415);
    expect((await fetch(`${base}/v1/classify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' })).status).toBe(400);
    expect((await classify({ ...video, textSample: 'y'.repeat(20_000) })).status).toBe(413);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });

  it('enforces the optional client token', async () => {
    const { classify } = await start({}, { CLIENT_TOKEN: 'app-token' });
    expect((await classify(video)).status).toBe(401);
    expect((await classify(video, { authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await classify(video, { authorization: 'Bearer app-token' })).status).toBe(200);
  });

  it('rate-limits per client and stops at the daily cap', async () => {
    const limited = await start({}, { RATE_LIMIT_PER_MINUTE: '2', DAILY_REQUEST_CAP: '1000' });
    const page = (n: number) => ({ ...video, key: `page-${n}` });
    expect((await limited.classify(page(1))).status).toBe(200);
    expect((await limited.classify(page(2))).status).toBe(200);
    expect((await limited.classify(page(3))).status).toBe(429);
    // Cached answers do not count against the limit.
    expect((await limited.classify(page(1))).status).toBe(200);

    const capped = new RateLimiter(100, 2, () => 0);
    expect([capped.take('a'), capped.take('b'), capped.take('c')]).toEqual([null, null, 'daily-cap']);
  });

  it('maps classifier failures and a missing key to clear status codes', async () => {
    const failing = await start({ classifier: vi.fn(async () => { throw new ClassifierError('provider down', true); }) });
    const response = await failing.classify(video);
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe('provider down');

    const refused = await start({ classifier: vi.fn(async () => { throw new ClassifierError('declined', false); }) });
    expect((await refused.classify(video)).status).toBe(502);

    const noKey = await start({ classifier: null });
    expect((await noKey.classify(video)).status).toBe(503);
  });
});

describe('Claude classifier', () => {
  function fakeClient(response: Partial<Anthropic.Message>) {
    const create = vi.fn(async () => response as Anthropic.Message);
    return { client: { messages: { create } } as unknown as Anthropic, create };
  }
  const metadata = { url: video.url, host: video.host, key: video.key, genre: 'Comedy', title: 'Funny cat compilation #shorts', description: '', keywords: [], headings: [], siteName: 'YouTube', ogType: 'video.other', lang: 'en', textSample: '' };

  it('sends a structured-output request with the study prompt and parses the result', async () => {
    const { client, create } = fakeClient({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"category":"entertainment","confidence":0.93,"rationale":"Comedy short."}', citations: null }]
    } as Partial<Anthropic.Message>);
    const classify = createClaudeClassifier({ apiKey: 'k', model: 'claude-haiku-5-5', client });
    await expect(classify(metadata, new AbortController().signal)).resolves.toEqual({ category: 'entertainment', confidence: 0.93, rationale: 'Comedy short.' });

    const [params] = create.mock.calls[0] as unknown as [Record<string, any>];
    expect(params.model).toBe('claude-haiku-5-5');
    expect(params.output_config).toMatchObject({ effort: 'low', format: { type: 'json_schema' } });
    expect(params.system).toContain('Judge the specific page, not the website');
    expect(params.messages[0].content).toContain('"genre": "Comedy"');
    expect(params).not.toHaveProperty('thinking');
  });

  it('turns refusals and bad output into classifier errors', async () => {
    const refused = createClaudeClassifier({ apiKey: 'k', model: 'm', client: fakeClient({ stop_reason: 'refusal', content: [] }).client });
    await expect(refused(metadata, new AbortController().signal)).rejects.toMatchObject({ name: 'ClassifierError', retryable: false });

    const garbled = createClaudeClassifier({
      apiKey: 'k',
      model: 'm',
      client: fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"category":"homework"}', citations: null }] } as Partial<Anthropic.Message>).client
    });
    await expect(garbled(metadata, new AbortController().signal)).rejects.toThrow('schema');
  });
});

describe('provider selection', () => {
  it('defaults to Claude, picks Gemini when it is the only key, and honours LLM_PROVIDER', () => {
    expect(readConfig({ ANTHROPIC_API_KEY: 'a' })).toMatchObject({ provider: 'claude', apiKey: 'a', model: 'claude-haiku-5-5' });
    expect(readConfig({ GEMINI_API_KEY: 'g' })).toMatchObject({ provider: 'gemini', apiKey: 'g', model: 'gemini-flash-lite-latest', fallbackModels: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'] });
    expect(readConfig({ GEMINI_API_KEY: 'g', GEMINI_FALLBACK_MODELS: ' a , b ,' }).fallbackModels).toEqual(['a', 'b']);
    expect(readConfig({ GEMINI_API_KEY: 'g', GEMINI_FALLBACK_MODELS: '' }).fallbackModels).toEqual([]);
    expect(readConfig({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g', LLM_PROVIDER: 'Gemini', GEMINI_MODEL: 'gemini-x' })).toMatchObject({
      provider: 'gemini',
      apiKey: 'g',
      model: 'gemini-x'
    });
    expect(readConfig({ GEMINI_API_KEY: 'g', LLM_PROVIDER: 'claude' })).toMatchObject({ provider: 'claude', apiKey: null });
  });
});

describe('Gemini classifier', () => {
  const metadata = { url: video.url, host: video.host, key: video.key, genre: 'Comedy', title: 'Funny cat compilation #shorts', description: '', keywords: [], headings: [], siteName: 'YouTube', ogType: 'video.other', lang: 'en', textSample: '' };
  function fakeFetch(status: number, body: unknown) {
    return vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  }
  const answer = (text: string, finishReason = 'STOP') => ({ candidates: [{ finishReason, content: { parts: [{ text: 'thinking...', thought: true }, { text }] } }] });

  it('sends the study prompt with a JSON schema and parses the answer, ignoring thoughts', async () => {
    const fetchImpl = fakeFetch(200, answer('{"category":"entertainment","confidence":0.92,"rationale":"Comedy short."}'));
    const classify = createGeminiClassifier({ apiKey: 'gk', models: ['gemini-flash-lite-latest'], fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(classify(metadata, new AbortController().signal)).resolves.toEqual({ category: 'entertainment', confidence: 0.92, rationale: 'Comedy short.' });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('gk');
    expect(url).not.toContain('gk');
    const body = JSON.parse(String(init.body));
    expect(body.systemInstruction.parts[0].text).toContain('Judge the specific page, not the website');
    expect(body.contents[0].parts[0].text).toContain('"genre": "Comedy"');
    expect(body.generationConfig).toMatchObject({ responseMimeType: 'application/json', responseJsonSchema: { required: ['category', 'confidence', 'rationale'] } });
  });

  it('maps API errors, safety blocks, truncation and bad output to classifier errors', async () => {
    const run = (status: number, body: unknown) =>
      createGeminiClassifier({ apiKey: 'k', models: ['m'], fetchImpl: fakeFetch(status, body) as unknown as typeof fetch })(metadata, new AbortController().signal);
    await expect(run(400, { error: { message: 'API key not valid. Please pass a valid API key.' } })).rejects.toMatchObject({ retryable: false, message: expect.stringContaining('invalid') });
    await expect(run(404, { error: { message: 'not found' } })).rejects.toMatchObject({ retryable: false, message: expect.stringContaining('not found') });
    await expect(run(429, { error: { message: 'quota' } })).rejects.toMatchObject({ retryable: true });
    await expect(run(503, {})).rejects.toMatchObject({ retryable: true });
    await expect(run(200, { promptFeedback: { blockReason: 'SAFETY' } })).rejects.toMatchObject({ retryable: false, message: expect.stringContaining('declined') });
    await expect(run(200, answer('', 'SAFETY'))).rejects.toMatchObject({ retryable: false });
    await expect(run(200, answer('{"category":', 'MAX_TOKENS'))).rejects.toMatchObject({ retryable: true, message: expect.stringContaining('truncated') });
    await expect(run(200, answer('{"category":"homework"}'))).rejects.toThrow('schema');
  });

  it('falls through to the next model when one is overloaded or retired, but not on a bad key', async () => {
    const replies: Array<[number, unknown]> = [
      [503, { error: { message: 'This model is currently experiencing high demand.' } }],
      [404, { error: { message: 'model retired' } }],
      [200, answer('{"category":"study","confidence":0.97,"rationale":"Python course."}')]
    ];
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => {
      const [status, body] = replies.shift()!;
      return new Response(JSON.stringify(body), { status });
    });
    const classify = createGeminiClassifier({ apiKey: 'k', models: ['a', 'b', 'c'], fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(classify(metadata, new AbortController().signal)).resolves.toMatchObject({ category: 'study' });
    expect(fetchImpl.mock.calls.map(([url]) => url.split('/models/')[1])).toEqual(['a:generateContent', 'b:generateContent', 'c:generateContent']);

    const allBusy = fakeFetch(503, {});
    await expect(
      createGeminiClassifier({ apiKey: 'k', models: ['a', 'b'], fetchImpl: allBusy as unknown as typeof fetch })(metadata, new AbortController().signal)
    ).rejects.toMatchObject({ retryable: true });
    expect(allBusy).toHaveBeenCalledTimes(2);

    const badKey = fakeFetch(403, { error: { message: 'denied' } });
    await expect(
      createGeminiClassifier({ apiKey: 'k', models: ['a', 'b'], fetchImpl: badKey as unknown as typeof fetch })(metadata, new AbortController().signal)
    ).rejects.toMatchObject({ retryable: false });
    expect(badKey).toHaveBeenCalledTimes(1);
  });

  it('gives a stalled model a time slice, then answers with the next model', async () => {
    const fetchImpl = vi.fn((url: string, init: RequestInit) => {
      if (url.includes('/models/slow:')) {
        // Never answers until aborted, like a stalled Gemini request.
        return new Promise<Response>((_resolve, reject) =>
          init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
        );
      }
      return Promise.resolve(new Response(JSON.stringify(answer('{"category":"study","confidence":0.95,"rationale":"Lecture."}'))));
    });
    const classify = createGeminiClassifier({ apiKey: 'k', models: ['slow', 'fast'], hedgeAfterMs: 30, fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(classify(metadata, new AbortController().signal)).resolves.toMatchObject({ category: 'study' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rethrows an abort from the caller so the server can answer with a timeout', async () => {
    const controller = new AbortController();
    const aborting = vi.fn(async () => {
      controller.abort();
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    }) as unknown as typeof fetch;
    const classify = createGeminiClassifier({ apiKey: 'k', models: ['m', 'n'], fetchImpl: aborting });
    await expect(classify(metadata, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(aborting).toHaveBeenCalledTimes(1);
  });
});
