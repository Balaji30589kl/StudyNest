import { describe, expect, it } from 'vitest';
import { buildErrorPageHtml, classifyLoadFailure, shouldShowErrorPage } from '../error-page.js';
import { parseInterstitial, wrapInterstitialHtml } from '../navigation-guard.js';
import {
  answerPermissionCheck,
  classifyPermission,
  describePermission,
  originOf,
  parseSitePermissions,
  permissionKey
} from './permission-policy.js';

describe('permission policy', () => {
  it('allows harmless, asks for sensitive, denies device access and unknowns', () => {
    expect(classifyPermission('fullscreen')).toBe('allow');
    expect(classifyPermission('clipboard-sanitized-write')).toBe('allow');
    for (const permission of ['media', 'geolocation', 'notifications', 'clipboard-read', 'display-capture', 'openExternal']) {
      expect(classifyPermission(permission)).toBe('ask');
    }
    for (const permission of ['midiSysex', 'hid', 'serial', 'usb', 'unknown', 'something-new']) {
      expect(classifyPermission(permission)).toBe('deny');
    }
  });

  it('keys media by device type and external links by protocol', () => {
    expect(permissionKey('media', { mediaTypes: ['video', 'audio', 'video'] })).toBe('media:audio,video');
    expect(permissionKey('media', {})).toBe('media:any');
    expect(permissionKey('openExternal', { externalURL: 'mailto:a@b.c' })).toBe('openExternal:mailto');
    expect(permissionKey('geolocation')).toBe('geolocation');
  });

  it('describes requests in plain language', () => {
    expect(describePermission('media', { mediaTypes: ['video'] })).toBe('use your camera');
    expect(describePermission('media', { mediaTypes: ['audio', 'video'] })).toBe('use your camera and microphone');
    expect(describePermission('openExternal', { externalURL: 'zoommtg://join' })).toContain('"zoommtg" link');
  });

  it('answers synchronous checks from stored decisions only', () => {
    const entries = [
      { origin: 'https://meet.example', key: 'media:audio,video', decision: 'allow' as const, decidedAt: 1 },
      { origin: 'https://maps.example', key: 'geolocation', decision: 'deny' as const, decidedAt: 1 }
    ];
    expect(answerPermissionCheck(entries, 'https://meet.example', 'media')).toBe(true);
    expect(answerPermissionCheck(entries, 'https://maps.example', 'geolocation')).toBe(false);
    expect(answerPermissionCheck(entries, 'https://other.example', 'media')).toBe(false);
    expect(answerPermissionCheck([], 'https://x.example', 'fullscreen')).toBe(true);
    expect(answerPermissionCheck([], 'https://x.example', 'usb')).toBe(false);
  });

  it('validates stored data and origins', () => {
    expect(parseSitePermissions([{ origin: 'https://a', key: 'geolocation', decision: 'allow', decidedAt: 1 }, { origin: 1 }, 'x'])).toHaveLength(1);
    expect(parseSitePermissions('nope')).toEqual([]);
    expect(originOf('https://a.example/path?q=1')).toBe('https://a.example');
    expect(originOf('data:text/html,hi')).toBeNull();
  });
});

describe('error pages', () => {
  it('ignores aborts and guard cancellations, and subframe failures', () => {
    expect(shouldShowErrorPage(-3, true)).toBe(false);
    expect(shouldShowErrorPage(-20, true)).toBe(false);
    expect(shouldShowErrorPage(-105, false)).toBe(false);
    expect(shouldShowErrorPage(-105, true)).toBe(true);
  });

  it('classifies common failures', () => {
    expect(classifyLoadFailure(-202)).toBe('certificate');
    expect(classifyLoadFailure(-106)).toBe('offline');
    expect(classifyLoadFailure(-105)).toBe('dns');
    expect(classifyLoadFailure(-102)).toBe('refused');
    expect(classifyLoadFailure(-118)).toBe('timeout');
    expect(classifyLoadFailure(-312)).toBe('generic');
  });

  it('escapes the URL and never offers a retry for certificate errors', () => {
    const cert = buildErrorPageHtml('https://evil.test/<script>', -202, 'ERR_CERT_AUTHORITY_INVALID');
    expect(cert).not.toContain('<script>');
    expect(cert).not.toContain('Try again');
    expect(buildErrorPageHtml('https://site.test/', -102, 'ERR_CONNECTION_REFUSED')).toContain('Try again');
  });

  it('tags interstitials by kind', () => {
    expect(parseInterstitial(wrapInterstitialHtml('<p>x</p>', 'https://a.test/', 'error'))).toEqual({ target: 'https://a.test/', kind: 'error' });
    expect(parseInterstitial(wrapInterstitialHtml('<p>x</p>', 'https://b.test/'))).toEqual({ target: 'https://b.test/', kind: 'blocked' });
    expect(parseInterstitial('https://c.test/')).toBeNull();
  });
});
