import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildCheckingHtml, buildInterstitialHtml, escapeHtml } from './interstitial-page.js';
import { parseInterstitialTarget, wrapInterstitialHtml } from '../navigation-guard.js';
import { createEmptyStudyData, JsonFileStudyStore, MAX_STORED_EVENTS, parseStudyData } from './study-store.js';

const tempDirs: string[] = [];

function makeTempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studynest-test-'));
  tempDirs.push(dir);
  return path.join(dir, 'nested', 'study-data.json');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('JsonFileStudyStore', () => {
  it('returns defaults when the file is missing or corrupt', () => {
    const filePath = makeTempFile();
    const store = new JsonFileStudyStore(filePath);
    expect(store.load()).toEqual(createEmptyStudyData());

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '{not json');
    expect(store.load()).toEqual(createEmptyStudyData());
  });

  it('round-trips data through flush', () => {
    const filePath = makeTempFile();
    const store = new JsonFileStudyStore(filePath, 10_000);
    const data = createEmptyStudyData();
    data.settings.defaultDurationMinutes = 45;
    data.events.push({ id: 'e1', type: 'visit', at: 1, sessionId: 's', host: 'example.com' });

    store.save(data);
    expect(fs.existsSync(filePath)).toBe(false);
    store.flush();

    expect(new JsonFileStudyStore(filePath).load()).toEqual(data);
  });
});

describe('parseStudyData', () => {
  it('drops malformed entries and caps the event log', () => {
    const events = Array.from({ length: MAX_STORED_EVENTS + 5 }, (_, index) => ({ id: `e${index}`, type: 'visit', at: index, sessionId: null }));
    const parsed = parseStudyData({ settings: { defaultDurationMinutes: 50 }, events: [...events, { bogus: true }], sessions: [42] });
    expect(parsed.settings.defaultDurationMinutes).toBe(50);
    expect(parsed.events).toHaveLength(MAX_STORED_EVENTS);
    expect(parsed.events.at(-1)?.id).toBe(`e${MAX_STORED_EVENTS + 4}`);
    expect(parsed.sessions).toEqual([]);
    expect(parsed.activeSession).toBeNull();
  });
});

describe('interstitial page', () => {
  it('escapes untrusted host text', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    const html = buildInterstitialHtml({
      blocked: { url: 'https://evil.test/<script>', host: '<script>alert(1)</script>', action: 'block', reason: 'blocklisted' },
      sessionEndsAt: null
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('Continue anyway');
    expect(html).toContain('until you turn it off');
  });

  it('explains AI verdicts and shows the checking screen', () => {
    const html = buildInterstitialHtml({
      blocked: { url: 'https://y.test/watch?v=1', host: 'y.test', action: 'block', reason: 'classified', classification: { category: 'entertainment', confidence: 0.92, providerId: 'gateway' } },
      sessionEndsAt: Date.now()
    });
    expect(html).toContain('<strong>entertainment</strong> (92% confidence)');
    expect(buildCheckingHtml('<b>y.test</b>')).toContain('&lt;b&gt;y.test&lt;/b&gt;');
  });

  it('offers an allowed YouTube search on blocked YouTube pages only', () => {
    const youtube = buildInterstitialHtml({
      blocked: { url: 'https://www.youtube.com/', host: 'youtube.com', action: 'block', reason: 'classified', classification: { category: 'entertainment', confidence: 0.9, providerId: 'gateway' } },
      sessionEndsAt: null
    });
    expect(youtube).toContain('<form class="search" action="https://www.youtube.com/results" method="get"');
    expect(youtube).toContain('name="search_query"');
    expect(youtube).toContain('Search YouTube instead');

    const shortLink = buildInterstitialHtml({ blocked: { url: 'https://youtu.be/x', host: 'youtu.be', action: 'block', reason: 'classified' }, sessionEndsAt: null });
    expect(shortLink).toContain('action="https://www.youtube.com/results"');

    const reddit = buildInterstitialHtml({ blocked: { url: 'https://reddit.com', host: 'reddit.com', action: 'block', reason: 'blocklisted' }, sessionEndsAt: null });
    expect(reddit).not.toContain('<form');
  });

  it('round-trips the blocked target through the data URL fragment', () => {
    const target = 'https://reddit.com/r/a#b?c=d';
    const url = wrapInterstitialHtml('<p>#hello</p>', target);
    expect(parseInterstitialTarget(url)).toBe(target);
    expect(parseInterstitialTarget('https://reddit.com')).toBeNull();
    expect(parseInterstitialTarget('data:text/html;charset=UTF-8,plain')).toBeNull();
  });
});
