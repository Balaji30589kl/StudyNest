import { describe, expect, it } from 'vitest';
import type { Classification } from './classification.js';
import {
  classificationKey,
  clampSessionMinutes,
  DEFAULT_CLASSIFICATION_POLICY,
  evaluateStudyPolicy,
  normalizeRuleList,
  parseRule,
  ruleMatches,
  sanitizeStudyPolicy,
  sanitizeStudySettings,
  StudyPolicy
} from './study-policy.js';

const policy: StudyPolicy = {
  block: ['reddit.com', 'youtube.com/shorts', 'youtube.com/feed/trending'],
  allow: ['wikipedia.org', 'youtube.com/results', 'old.reddit.com/r/learnprogramming'],
  classification: { ...DEFAULT_CLASSIFICATION_POLICY, perPageHosts: ['youtube.com', 'youtu.be'] }
};
const on = { studyActive: true, policy };

function prediction(category: Classification['category'], confidence = 0.9): Classification {
  return { category, confidence, rationale: '', host: 'youtube.com', key: 'k', providerId: 'gateway', fallback: false, classifiedAt: 0 };
}

describe('rules', () => {
  it('parses domains with optional path prefixes', () => {
    expect(parseRule('https://www.YouTube.com/Shorts/')).toEqual({ host: 'youtube.com', path: '/shorts' });
    expect(parseRule('*.reddit.com')).toEqual({ host: 'reddit.com', path: '' });
    expect(parseRule('localhost')).toEqual({ host: 'localhost', path: '' });
    expect(parseRule('127.0.0.1/videos')).toEqual({ host: '127.0.0.1', path: '/videos' });
    expect(parseRule('not a domain')).toBeNull();
    expect(parseRule('youtube')).toBeNull();
    expect(normalizeRuleList(['YouTube.com/shorts', 'youtube.com/shorts/', 42, 'bad rule'])).toEqual(['youtube.com/shorts']);
  });

  it('matches subdomains and whole path segments only', () => {
    const shorts = parseRule('youtube.com/shorts')!;
    expect(ruleMatches(shorts, 'm.youtube.com', '/shorts/abc')).toBe(true);
    expect(ruleMatches(shorts, 'youtube.com', '/shorts')).toBe(true);
    expect(ruleMatches(shorts, 'youtube.com', '/shortsfeed')).toBe(false);
    expect(ruleMatches(shorts, 'notyoutube.com', '/shorts')).toBe(false);
  });
});

describe('evaluateStudyPolicy', () => {
  it('allows everything when Study Mode is off', () => {
    expect(evaluateStudyPolicy('https://reddit.com', { studyActive: false, policy }).action).toBe('allow');
  });

  it('allows internal pages', () => {
    expect(evaluateStudyPolicy('data:text/html,hi', on)).toMatchObject({ action: 'allow', reason: 'internal' });
  });

  it('blocks block-listed sites and paths', () => {
    expect(evaluateStudyPolicy('https://www.reddit.com/r/memes', on)).toMatchObject({ action: 'block', reason: 'blocklisted', matchedRule: 'reddit.com' });
    expect(evaluateStudyPolicy('https://www.youtube.com/shorts/xyz', on)).toMatchObject({ action: 'block', matchedRule: 'youtube.com/shorts' });
  });

  it('allows allow-listed sites, with the most specific rule winning', () => {
    expect(evaluateStudyPolicy('https://en.wikipedia.org/wiki/Graph', on)).toMatchObject({ action: 'allow', reason: 'allowlisted' });
    expect(evaluateStudyPolicy('https://www.youtube.com/results?search_query=calculus', on).action).toBe('allow');
    expect(evaluateStudyPolicy('https://old.reddit.com/r/learnprogramming/top', on)).toMatchObject({ action: 'allow', reason: 'allowlisted' });
  });

  it('lets a block rule win a tie', () => {
    const tie = { ...policy, allow: ['reddit.com'] };
    expect(evaluateStudyPolicy('https://reddit.com', { studyActive: true, policy: tie }).action).toBe('block');
  });

  it('asks for a check when an unlisted page has no prediction yet', () => {
    expect(evaluateStudyPolicy('https://www.youtube.com/watch?v=abc', on)).toMatchObject({ action: 'check', reason: 'unclassified', host: 'youtube.com' });
  });

  it('decides unlisted pages from the prediction', () => {
    const lecture = evaluateStudyPolicy('https://www.youtube.com/watch?v=a', { ...on, classification: prediction('study') });
    expect(lecture).toMatchObject({ action: 'allow', reason: 'classified', classification: { category: 'study' } });

    const comedy = evaluateStudyPolicy('https://www.youtube.com/watch?v=b', { ...on, classification: prediction('entertainment') });
    expect(comedy).toMatchObject({ action: 'block', reason: 'classified', classification: { category: 'entertainment' } });

    const unsure = evaluateStudyPolicy('https://www.youtube.com/watch?v=c', { ...on, classification: prediction('entertainment', 0.4) });
    expect(unsure.action).toBe('allow');
  });

  it('blocks sports and keeps unidentified videos blocked, but not unidentified websites', () => {
    expect(evaluateStudyPolicy('https://www.youtube.com/watch?v=d', { ...on, classification: prediction('sports') }).action).toBe('block');
    const unclear = evaluateStudyPolicy('https://www.youtube.com/watch?v=e', { ...on, classification: prediction('other', 0.3) });
    expect(unclear).toMatchObject({ action: 'block', reason: 'classified', classification: { category: 'other' } });
    expect(evaluateStudyPolicy('https://www.youtube.com/watch?v=f', { ...on, classification: prediction('other', 0.8) }).action).toBe('allow');
    expect(evaluateStudyPolicy('https://example.com/article', { ...on, classification: prediction('other', 0.3) }).action).toBe('allow');
    const relaxed = { ...policy, classification: { ...policy.classification, blockUnclearPerPage: false } };
    expect(evaluateStudyPolicy('https://www.youtube.com/watch?v=e', { studyActive: true, policy: relaxed, classification: prediction('other', 0.3) }).action).toBe('allow');
  });

  it('never lets a prediction override a list rule', () => {
    expect(evaluateStudyPolicy('https://reddit.com', { ...on, classification: prediction('study') }).action).toBe('block');
    expect(evaluateStudyPolicy('https://wikipedia.org', { ...on, classification: prediction('entertainment') }).action).toBe('allow');
  });

  it('opens unlisted sites normally when AI checks are disabled', () => {
    const noAi = { ...policy, classification: { ...policy.classification, enabled: false } };
    expect(evaluateStudyPolicy('https://example.com', { studyActive: true, policy: noAi })).toMatchObject({ action: 'allow', reason: 'ai-disabled' });
  });
});

describe('classificationKey', () => {
  const ai = policy.classification;
  it('judges video platforms per video and other sites per site', () => {
    expect(classificationKey('https://www.youtube.com/watch?v=abc&t=30', ai)).toBe('youtube.com/watch?v=abc');
    expect(classificationKey('https://youtu.be/abc', ai)).toBe('youtube.com/watch?v=abc');
    expect(classificationKey('https://m.youtube.com/watch?v=abc', ai)).toBe('youtube.com/watch?v=abc');
    expect(classificationKey('https://www.youtube.com/@channel/videos', ai)).toBe('youtube.com/@channel/videos');
    expect(classificationKey('https://news.example.com/story/1', ai)).toBe('news.example.com');
    // Other per-page sites keep content-identifying query parameters and drop tracking ones.
    const vimeo = { ...ai, perPageHosts: ['videos.test'] };
    expect(classificationKey('https://videos.test/watch?v=2&utm_source=x&t=40', vimeo)).toBe('videos.test/watch?v=2');
    expect(classificationKey('https://videos.test/watch?b=1&a=2', vimeo)).toBe('videos.test/watch?a=2&b=1');
    // A YouTube search is one page however YouTube re-encodes it after loading.
    const search = classificationKey('https://www.youtube.com/results?search_query=linear+algebra', ai);
    expect(search).toBe('youtube.com/results?search_query=linear+algebra');
    expect(classificationKey('https://www.youtube.com/results?search_query=linear%20algebra&themeRefresh=1', ai)).toBe(search);
    expect(classificationKey('https://www.youtube.com/results?search_query=funny+cats', ai)).not.toBe(search);
    expect(classificationKey('about:blank', ai)).toBeNull();
  });
});

describe('validation', () => {
  it('sanitizes policy files and keeps the base for missing parts', () => {
    const result = sanitizeStudyPolicy(
      { block: { rules: ['TikTok.com', 'bad rule', 7] }, classification: { minConfidence: 5, distractingCategories: ['gaming', 'nope'], perPageHosts: ['Vimeo.com'] } },
      policy
    );
    expect(result.block).toEqual(['tiktok.com']);
    expect(result.allow).toEqual(policy.allow);
    expect(result.classification).toMatchObject({ minConfidence: 0.99, distractingCategories: ['gaming'], perPageHosts: ['vimeo.com'] });
  });

  it('sanitizes user settings and clamps session length', () => {
    expect(sanitizeStudySettings({ defaultDurationMinutes: 1000, blocklist: ['x'] })).toEqual({ defaultDurationMinutes: 240 });
    expect(clampSessionMinutes(1)).toBe(5);
    expect(clampSessionMinutes('abc', 30)).toBe(30);
  });
});
