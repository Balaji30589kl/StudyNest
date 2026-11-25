import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FocusView } from '../main/study/focus-view.js';
import { DEFAULT_FOCUS_RULES, focusBlocksRequest, focusCssFor, isSafeSelector, sanitizeFocusRules } from './focus-rules.js';
import { sanitizeStudyPolicy } from './study-policy.js';

describe('focus rules', () => {
  it('accepts selectors but nothing that could inject other CSS', () => {
    expect(isSafeSelector('ytd-watch-flexy #secondary')).toBe(true);
    expect(isSafeSelector('yt-lockup-view-model:has(a[href^="/shorts/"])')).toBe(true);
    expect(isSafeSelector('body { display: none }')).toBe(false);
    expect(isSafeSelector('a; @import url(x)')).toBe(false);
    expect(isSafeSelector('a /* comment */')).toBe(false);
    expect(isSafeSelector('a:has(b')).toBe(false);
    expect(isSafeSelector('a[href="x]')).toBe(false);
    expect(isSafeSelector('')).toBe(false);
  });

  it('sanitizes rules from a policy file', () => {
    const rules = sanitizeFocusRules({
      rules: [
        { hosts: ['WWW.YouTube.com', 'bad host'], hide: ['#related', 'x { color: red }', '#related'], note: { text: '  Focus   on ', before: '#below' } },
        { hosts: ['example.com'], hide: [] },
        'junk'
      ]
    });
    expect(rules).toEqual([{ hosts: ['youtube.com'], hide: ['#related'], note: { text: 'Focus on', before: '#below' } }]);
    expect(sanitizeFocusRules(undefined)).toBeNull();
  });

  it('builds a stylesheet only for matching sites, with an escaped notice', () => {
    const rules = [{ hosts: ['youtube.com'], hide: ['#related', 'ytd-comments'], note: { text: 'He said "focus" \\ now', before: '#below' } }];
    const css = focusCssFor(rules, 'm.youtube.com')!;
    expect(css).toContain('html[data-studynest-focus] :is(\n  #related,\n  ytd-comments\n) {\n  display: none !important;');
    expect(css).toContain('html[data-studynest-focus] #below::before {\n  content: "He said \\"focus\\" \\\\ now";');
    expect(focusCssFor(rules, 'notyoutube.com')).toBeNull();
    expect(focusCssFor(rules, null)).toBeNull();
  });

  it('ships a valid focus.json that matches the built-in defaults', () => {
    const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../policy/focus.json'), 'utf-8'));
    const rules = sanitizeFocusRules(raw)!;
    expect(rules).toEqual(DEFAULT_FOCUS_RULES);
    const youtube = focusCssFor(rules, 'www.youtube.com')!;
    for (const selector of ['ytd-video-preview', '#video-preview', 'ytd-moving-thumbnail-renderer', '.ytp-ad-player-overlay-layout']) {
      expect(youtube).toContain(selector);
    }
    // Recommendations and comments stay visible: videos opened from them are checked anyway.
    for (const selector of ['#secondary', 'ytd-watch-next-secondary-results-renderer', 'ytd-comments', 'ytd-reel-shelf-renderer']) {
      expect(youtube).not.toContain(selector);
    }
  });

  it("refuses YouTube's animated hover thumbnails, only for pages of the rule's sites", () => {
    expect(focusBlocksRequest(DEFAULT_FOCUS_RULES, 'www.youtube.com', 'https://i.ytimg.com/an_webp/9vKqVkMQHKk/mqdefault_6s.webp?du=3000')).toBe(true);
    expect(focusBlocksRequest(DEFAULT_FOCUS_RULES, 'www.youtube.com', 'https://i.ytimg.com/vi/9vKqVkMQHKk/hqdefault.jpg')).toBe(false);
    expect(focusBlocksRequest(DEFAULT_FOCUS_RULES, 'example.com', 'https://i.ytimg.com/an_webp/x/mq.webp')).toBe(false);
    expect(focusBlocksRequest(DEFAULT_FOCUS_RULES, null, 'https://i.ytimg.com/an_webp/x/mq.webp')).toBe(false);
    expect(focusCssFor(DEFAULT_FOCUS_RULES, 'youtube.com')).toContain('img[src*="/an_webp/"]');
  });

  it('validates request prefixes from a policy file', () => {
    const [rule] = sanitizeFocusRules({ rules: [{ hosts: ['a.test'], hide: ['#x'], blockRequests: ['https://CDN.test/clips/', 'not a host', 'cdn.test/clips/', 'javascript:alert(1)'] }] })!;
    expect(rule!.blockRequests).toEqual(['cdn.test/clips/']);
  });

  it('keeps the base rules when a policy has no focus section', () => {
    expect(sanitizeStudyPolicy({}).focus).toEqual(DEFAULT_FOCUS_RULES);
    expect(sanitizeStudyPolicy({ focus: { rules: [] } }).focus).toEqual([]);
  });
});

describe('focus view', () => {
  function fakePage(url: string, id = 1) {
    const attribute: { on: boolean } = { on: false };
    const webContents = {
      id,
      isDestroyed: () => false,
      insertCSS: vi.fn(async () => 'key'),
      removeInsertedCSS: vi.fn(async () => undefined),
      executeJavaScriptInIsolatedWorld: vi.fn(async (_world: number, scripts: Array<{ code: string }>) => {
        const code = scripts[0]!.code;
        if (code.startsWith("document.documentElement.setAttribute('data-studynest-focus'")) attribute.on = true;
        else if (code.startsWith("document.documentElement.removeAttribute('data-studynest-focus'")) attribute.on = false;
      }),
      once: vi.fn()
    };
    return { tabId: `t${id}`, url, webContents: webContents as never as Electron.WebContents, raw: webContents, attribute };
  }

  it('styles each document once and switches the view with Study Mode, never removing CSS', async () => {
    let studying = false;
    const youtube = fakePage('https://www.youtube.com/watch?v=1', 1);
    const docs = fakePage('https://docs.python.org/3/', 2);
    const view = new FocusView({ getRules: () => DEFAULT_FOCUS_RULES, isStudyActive: () => studying, getOpenPages: () => [youtube, docs] });

    view.onDocumentReady(youtube);
    view.onDocumentReady(docs);
    await view.settled();
    expect(youtube.raw.insertCSS).toHaveBeenCalledTimes(1);
    expect(youtube.attribute.on).toBe(false);
    expect(docs.raw.insertCSS).not.toHaveBeenCalled();

    studying = true;
    view.refresh();
    view.refresh();
    await view.settled();
    expect(youtube.attribute.on).toBe(true);
    expect(youtube.raw.insertCSS).toHaveBeenCalledTimes(1);

    // A reload is a new document: style it again, already switched on.
    youtube.attribute.on = false;
    view.onDocumentReady(youtube);
    view.refresh();
    await view.settled();
    expect(youtube.raw.insertCSS).toHaveBeenCalledTimes(2);
    expect(youtube.attribute.on).toBe(true);

    studying = false;
    view.refresh();
    await view.settled();
    expect(youtube.attribute.on).toBe(false);
    expect(youtube.raw.removeInsertedCSS).not.toHaveBeenCalled();
    expect(youtube.raw.once).toHaveBeenCalledTimes(1);
    // The YouTube ad skipper is installed once per document, and only on YouTube.
    const skipperRuns = (page: typeof youtube) => page.raw.executeJavaScriptInIsolatedWorld.mock.calls.filter(([, scripts]) => scripts[0]!.code.includes('__studynestAdSkipper')).length;
    expect(skipperRuns(youtube)).toBe(2);
    expect(skipperRuns(docs)).toBe(0);
  });
});
