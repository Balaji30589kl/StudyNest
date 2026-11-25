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
  | { type: 'zoom-reset' };

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
    return null;
  }

  if (noModifiers) {
    if (key === 'F5') return { type: 'reload' };
    if (key === 'F6') return { type: 'focus-address' };
    if (key === 'BrowserBack') return { type: 'back' };
    if (key === 'BrowserForward') return { type: 'forward' };
  }

  return null;
}

/** Actions the renderer must perform (they need renderer state such as the homepage). */
export function isRendererCommand(action: ShortcutAction): action is { type: 'new-tab' } | { type: 'focus-address' } {
  return action.type === 'new-tab' || action.type === 'focus-address';
}
