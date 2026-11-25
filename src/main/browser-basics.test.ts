import { describe, expect, it } from 'vitest';
import { isRendererCommand, KeyInput, matchShortcut } from './shortcuts.js';
import { parseWindowState, resolveWindowBounds } from './window-state.js';

function key(keyName: string, mods: Partial<KeyInput> = {}): KeyInput {
  return { type: 'keyDown', key: keyName, control: false, shift: false, alt: false, meta: false, ...mods };
}

describe('matchShortcut', () => {
  it('maps standard Windows browser shortcuts', () => {
    expect(matchShortcut(key('t', { control: true }))).toEqual({ type: 'new-tab' });
    expect(matchShortcut(key('T', { control: true }))).toEqual({ type: 'new-tab' });
    expect(matchShortcut(key('w', { control: true }))).toEqual({ type: 'close-tab' });
    expect(matchShortcut(key('F4', { control: true }))).toEqual({ type: 'close-tab' });
    expect(matchShortcut(key('T', { control: true, shift: true }))).toEqual({ type: 'reopen-closed-tab' });
    expect(matchShortcut(key('Tab', { control: true }))).toEqual({ type: 'next-tab' });
    expect(matchShortcut(key('Tab', { control: true, shift: true }))).toEqual({ type: 'previous-tab' });
    expect(matchShortcut(key('PageUp', { control: true }))).toEqual({ type: 'previous-tab' });
    expect(matchShortcut(key('3', { control: true }))).toEqual({ type: 'select-tab', index: 2 });
    expect(matchShortcut(key('9', { control: true }))).toEqual({ type: 'select-last-tab' });
    expect(matchShortcut(key('l', { control: true }))).toEqual({ type: 'focus-address' });
    expect(matchShortcut(key('d', { alt: true }))).toEqual({ type: 'focus-address' });
    expect(matchShortcut(key('F6'))).toEqual({ type: 'focus-address' });
    expect(matchShortcut(key('F5'))).toEqual({ type: 'reload' });
    expect(matchShortcut(key('r', { control: true }))).toEqual({ type: 'reload' });
    expect(matchShortcut(key('F5', { control: true }))).toEqual({ type: 'hard-reload' });
    expect(matchShortcut(key('ArrowLeft', { alt: true }))).toEqual({ type: 'back' });
    expect(matchShortcut(key('ArrowRight', { alt: true }))).toEqual({ type: 'forward' });
    expect(matchShortcut(key('=', { control: true }))).toEqual({ type: 'zoom-in' });
    expect(matchShortcut(key('-', { control: true }))).toEqual({ type: 'zoom-out' });
    expect(matchShortcut(key('0', { control: true }))).toEqual({ type: 'zoom-reset' });
  });

  it('maps find, history, bookmarks, downloads, print and developer tools', () => {
    expect(matchShortcut(key('f', { control: true }))).toEqual({ type: 'find' });
    expect(matchShortcut(key('h', { control: true }))).toEqual({ type: 'open-page', page: 'history' });
    expect(matchShortcut(key('O', { control: true, shift: true }))).toEqual({ type: 'open-page', page: 'bookmarks' });
    expect(matchShortcut(key(',', { control: true }))).toEqual({ type: 'open-page', page: 'settings' });
    expect(matchShortcut(key('Delete', { control: true, shift: true }))).toEqual({ type: 'open-page', page: 'settings', section: 'privacy' });
    expect(matchShortcut(key('j', { control: true }))).toEqual({ type: 'open-panel', panel: 'downloads' });
    expect(matchShortcut(key('d', { control: true }))).toEqual({ type: 'bookmark-page' });
    expect(matchShortcut(key('B', { control: true, shift: true }))).toEqual({ type: 'toggle-bookmarks-bar' });
    expect(matchShortcut(key('p', { control: true }))).toEqual({ type: 'print' });
    expect(matchShortcut(key('F12'))).toEqual({ type: 'devtools' });
    expect(matchShortcut(key('I', { control: true, shift: true }))).toEqual({ type: 'devtools' });
    expect(matchShortcut(key('Home', { alt: true }))).toEqual({ type: 'home' });
  });

  it('ignores ordinary typing, key-up events, and AltGr combinations', () => {
    expect(matchShortcut(key('t'))).toBeNull();
    expect(matchShortcut(key('ArrowLeft'))).toBeNull();
    expect(matchShortcut({ ...key('t', { control: true }), type: 'keyUp' })).toBeNull();
    // AltGr reports as Ctrl+Alt on Windows; it must keep producing characters.
    expect(matchShortcut(key('l', { control: true, alt: true }))).toBeNull();
    expect(matchShortcut(key('c', { control: true }))).toBeNull();
  });

  it('flags commands the renderer must handle', () => {
    expect(isRendererCommand({ type: 'new-tab' })).toBe(true);
    expect(isRendererCommand({ type: 'focus-address' })).toBe(true);
    expect(isRendererCommand({ type: 'find' })).toBe(true);
    expect(isRendererCommand({ type: 'open-panel', panel: 'downloads' })).toBe(true);
    expect(isRendererCommand({ type: 'print' })).toBe(false);
    expect(isRendererCommand({ type: 'reload' })).toBe(false);
  });
});

describe('window state', () => {
  const primary = { x: 0, y: 0, width: 1920, height: 1040 };
  const secondary = { x: 1920, y: 0, width: 1280, height: 984 };

  it('parses saved state defensively', () => {
    expect(parseWindowState({ bounds: { x: 1, y: 2, width: 3, height: 4 }, maximized: true })).toEqual({
      bounds: { x: 1, y: 2, width: 3, height: 4 },
      maximized: true
    });
    expect(parseWindowState({ bounds: { x: 'a' } })).toEqual({ bounds: null, maximized: false });
    expect(parseWindowState(null)).toEqual({ bounds: null, maximized: false });
  });

  it('reuses bounds that are on a connected display', () => {
    expect(resolveWindowBounds({ x: 100, y: 50, width: 1300, height: 900 }, [primary])).toEqual({ x: 100, y: 50, width: 1300, height: 900 });
    expect(resolveWindowBounds({ x: 2000, y: 20, width: 1200, height: 800 }, [primary, secondary])).toEqual({
      x: 2000,
      y: 20,
      width: 1200,
      height: 800
    });
  });

  it('falls back when the saved monitor is gone', () => {
    expect(resolveWindowBounds({ x: 2000, y: 20, width: 1200, height: 800 }, [primary])).toBeNull();
    expect(resolveWindowBounds(null, [primary])).toBeNull();
  });

  it('clamps oversized or partly off-screen windows into the work area', () => {
    expect(resolveWindowBounds({ x: 1500, y: -30, width: 2600, height: 1400 }, [primary])).toEqual({ x: 0, y: 0, width: 1920, height: 1040 });
    expect(resolveWindowBounds({ x: 1000, y: 300, width: 1200, height: 900 }, [primary])).toEqual({ x: 720, y: 140, width: 1200, height: 900 });
  });
});
