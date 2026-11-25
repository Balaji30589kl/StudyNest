/**
 * Browser keyboard shortcuts (Windows conventions). Pure mapping from a key
 * event to an action so it can be unit tested; wiring lives in main/index.ts.
 */

export type ShortcutAction =
  | { type: 'new-tab' }
  | { type: 'close-tab' }
  | { type: 'reopen-closed-tab' }
  | { type: 'next-tab' }
  | { type: 'previous-tab' }
  | { type: 'select-tab'; index: number }
  | { type: 'select-last-tab' }
  | { type: 'focus-address' }
  | { type: 'reload' }
  | { type: 'hard-reload' }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'zoom-in' }
  | { type: 'zoom-out' }
  | { type: 'zoom-reset' }
  | { type: 'find' }
  | { type: 'open-panel'; panel: 'downloads' }
  | { type: 'open-page'; page: 'history' | 'bookmarks' | 'settings'; section?: string }
  | { type: 'bookmark-page' }
  | { type: 'toggle-bookmarks-bar' }
  | { type: 'print' }
  | { type: 'devtools' }
  | { type: 'home' };

/** The subset of Electron's `Input` the mapping needs. */
export type KeyInput = {
  type: string;
  key: string;
  code?: string;
  control: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  isAutoRepeat?: boolean;
};

export function matchShortcut(input: KeyInput): ShortcutAction | null {
  if (input.type !== 'keyDown' || input.meta) {
    return null;
  }

  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;
  const ctrl = input.control && !input.alt;
  const plainAlt = input.alt && !input.control && !input.shift;
  const noModifiers = !input.control && !input.alt && !input.shift;

  if (ctrl) {
    if (input.shift) {
      if (key === 't') return { type: 'reopen-closed-tab' };
      if (key === 'Tab') return { type: 'previous-tab' };
      if (key === 'r') return { type: 'hard-reload' };
      if (key === 'o') return { type: 'open-page', page: 'bookmarks' };
      if (key === 'b') return { type: 'toggle-bookmarks-bar' };
      if (key === 'i') return { type: 'devtools' };
      if (key === 'Delete') return { type: 'open-page', page: 'settings', section: 'privacy' };
      return null;
    }
    switch (key) {
      case 't':
        return { type: 'new-tab' };
      case 'w':
      case 'F4':
        return { type: 'close-tab' };
      case 'Tab':
      case 'PageDown':
        return { type: 'next-tab' };
      case 'PageUp':
        return { type: 'previous-tab' };
      case 'l':
        return { type: 'focus-address' };
      case 'f':
        return { type: 'find' };
      case 'h':
        return { type: 'open-page', page: 'history' };
      case 'j':
        return { type: 'open-panel', panel: 'downloads' };
      case 'd':
        return { type: 'bookmark-page' };
      case 'p':
        return { type: 'print' };
      case ',':
        return { type: 'open-page', page: 'settings' };
      case 'r':
        return { type: 'reload' };
      case 'F5':
        return { type: 'hard-reload' };
      case '=':
      case '+':
        return { type: 'zoom-in' };
      case '-':
        return { type: 'zoom-out' };
      case '0':
        return { type: 'zoom-reset' };
      case '9':
        return { type: 'select-last-tab' };
      default:
        if (/^[1-8]$/.test(key)) {
          return { type: 'select-tab', index: Number(key) - 1 };
        }
        return null;
    }
  }

  if (plainAlt) {
    if (key === 'ArrowLeft') return { type: 'back' };
    if (key === 'ArrowRight') return { type: 'forward' };
    if (key === 'd') return { type: 'focus-address' };
    if (key === 'Home') return { type: 'home' };
    return null;
  }

  if (noModifiers) {
    if (key === 'F5') return { type: 'reload' };
    if (key === 'F6') return { type: 'focus-address' };
    if (key === 'F12') return { type: 'devtools' };
    if (key === 'BrowserBack') return { type: 'back' };
    if (key === 'BrowserForward') return { type: 'forward' };
  }

  return null;
}

export type RendererCommandAction = Extract<ShortcutAction, { type: 'new-tab' | 'focus-address' | 'find' | 'open-panel' }>;

/** Actions the renderer must perform (they need renderer state: focus, the find bar, side panels). */
export function isRendererCommand(action: ShortcutAction): action is RendererCommandAction {
  return action.type === 'new-tab' || action.type === 'focus-address' || action.type === 'find' || action.type === 'open-panel';
}
