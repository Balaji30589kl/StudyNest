import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron';

/** Shown next to menu items; the shortcuts themselves are handled by shortcuts.ts. */
const shortcut = (accelerator: string) => ({ accelerator, registerAccelerator: false });

function truncate(text: string, max = 32): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export type PageMenuActions = {
  searchEngineName: string;
  canGoBack: boolean;
  canGoForward: boolean;
  openInNewTab: (url: string) => void;
  copyText: (text: string) => void;
  copyImageAt: (x: number, y: number) => void;
  download: (url: string) => void;
  searchFor: (text: string) => void;
  replaceMisspelling: (word: string) => void;
  addToDictionary: (word: string) => void;
  back: () => void;
  forward: () => void;
  reload: () => void;
  print: () => void;
  inspect: (x: number, y: number) => void;
};

type PageMenuParams = Pick<
  ContextMenuParams,
  'x' | 'y' | 'linkURL' | 'srcURL' | 'mediaType' | 'hasImageContents' | 'isEditable' | 'selectionText' | 'misspelledWord' | 'dictionarySuggestions' | 'editFlags'
>;

/** Right-click menu inside a web page, depending on what was clicked. */
export function buildPageMenu(params: PageMenuParams, actions: PageMenuActions): MenuItemConstructorOptions[] {
  const sections: MenuItemConstructorOptions[][] = [];
  const selection = params.selectionText.trim();

  if (params.isEditable && params.misspelledWord) {
    const suggestions = params.dictionarySuggestions.slice(0, 4).map<MenuItemConstructorOptions>((word) => ({
      label: word,
      click: () => actions.replaceMisspelling(word)
    }));
    sections.push([
      ...(suggestions.length > 0 ? suggestions : [{ label: 'No spelling suggestions', enabled: false }]),
      { label: 'Add to dictionary', click: () => actions.addToDictionary(params.misspelledWord) }
    ]);
  }

  if (isWebUrl(params.linkURL)) {
    sections.push([
      { label: 'Open link in new tab', click: () => actions.openInNewTab(params.linkURL) },
      { label: 'Copy link address', click: () => actions.copyText(params.linkURL) },
      { label: 'Save link as…', click: () => actions.download(params.linkURL) }
    ]);
  }

  if (params.mediaType === 'image' && isWebUrl(params.srcURL)) {
    sections.push([
      { label: 'Open image in new tab', click: () => actions.openInNewTab(params.srcURL) },
      { label: 'Save image as…', click: () => actions.download(params.srcURL) },
      { label: 'Copy image', enabled: params.hasImageContents, click: () => actions.copyImageAt(params.x, params.y) },
      { label: 'Copy image address', click: () => actions.copyText(params.srcURL) }
    ]);
  }

  if (params.isEditable) {
    sections.push([
      { role: 'undo', enabled: params.editFlags.canUndo, ...shortcut('Ctrl+Z') },
      { role: 'redo', enabled: params.editFlags.canRedo, ...shortcut('Ctrl+Y') }
    ]);
    sections.push([
      { role: 'cut', enabled: params.editFlags.canCut, ...shortcut('Ctrl+X') },
      { role: 'copy', enabled: params.editFlags.canCopy, ...shortcut('Ctrl+C') },
      { role: 'paste', enabled: params.editFlags.canPaste, ...shortcut('Ctrl+V') },
      { role: 'pasteAndMatchStyle', label: 'Paste as plain text', enabled: params.editFlags.canPaste, ...shortcut('Ctrl+Shift+V') },
      { role: 'selectAll', enabled: params.editFlags.canSelectAll, ...shortcut('Ctrl+A') }
    ]);
  } else if (selection) {
    sections.push([
      { role: 'copy', ...shortcut('Ctrl+C') },
      { label: `Search ${actions.searchEngineName} for “${truncate(selection)}”`, click: () => actions.searchFor(selection) }
    ]);
  }

  if (sections.length === 0) {
    sections.push([
      { label: 'Back', enabled: actions.canGoBack, click: actions.back, ...shortcut('Alt+Left') },
      { label: 'Forward', enabled: actions.canGoForward, click: actions.forward, ...shortcut('Alt+Right') },
      { label: 'Reload', click: actions.reload, ...shortcut('Ctrl+R') }
    ]);
    sections.push([
      { role: 'selectAll', label: 'Select all', ...shortcut('Ctrl+A') },
      { label: 'Print…', click: actions.print, ...shortcut('Ctrl+P') }
    ]);
  }

  sections.push([{ label: 'Inspect', click: () => actions.inspect(params.x, params.y), ...shortcut('Ctrl+Shift+I') }]);
  return joinSections(sections);
}

export type TabMenuActions = {
  pinned: boolean;
  muted: boolean;
  isOnlyTab: boolean;
  hasTabsToRight: boolean;
  canReopen: boolean;
  newTabToRight: () => void;
  reload: () => void;
  duplicate: () => void;
  togglePin: () => void;
  toggleMute: () => void;
  close: () => void;
  closeOthers: () => void;
  closeToRight: () => void;
  reopenClosed: () => void;
};

/** Right-click menu on a tab. */
export function buildTabMenu(actions: TabMenuActions): MenuItemConstructorOptions[] {
  return joinSections([
    [{ label: 'New tab to the right', click: actions.newTabToRight }],
    [
      { label: 'Reload', click: actions.reload, ...shortcut('Ctrl+R') },
      { label: 'Duplicate', click: actions.duplicate },
      { label: actions.pinned ? 'Unpin' : 'Pin', click: actions.togglePin },
      { label: actions.muted ? 'Unmute tab' : 'Mute tab', click: actions.toggleMute }
    ],
    [
      { label: 'Close', click: actions.close, ...shortcut('Ctrl+W') },
      { label: 'Close other tabs', enabled: !actions.isOnlyTab, click: actions.closeOthers },
      { label: 'Close tabs to the right', enabled: actions.hasTabsToRight, click: actions.closeToRight }
    ],
    [{ label: 'Reopen closed tab', enabled: actions.canReopen, click: actions.reopenClosed, ...shortcut('Ctrl+Shift+T') }]
  ]);
}

export type AppMenuActions = {
  zoomPercent: number;
  canZoom: boolean;
  showBookmarksBar: boolean;
  studyActive: boolean;
  newTab: () => void;
  reopenClosed: () => void;
  openPage: (page: 'history' | 'bookmarks' | 'settings') => void;
  openPanel: (panel: 'downloads' | 'study' | 'insights') => void;
  zoom: (steps: number) => void;
  find: () => void;
  print: () => void;
  toggleBookmarksBar: () => void;
  clearData: () => void;
  quit: () => void;
};

/** The ⋯ menu at the end of the toolbar. */
export function buildAppMenu(actions: AppMenuActions): MenuItemConstructorOptions[] {
  return joinSections([
    [
      { label: 'New tab', click: actions.newTab, ...shortcut('Ctrl+T') },
      { label: 'Reopen closed tab', click: actions.reopenClosed, ...shortcut('Ctrl+Shift+T') }
    ],
    [
      { label: 'History', click: () => actions.openPage('history'), ...shortcut('Ctrl+H') },
      { label: 'Bookmarks', click: () => actions.openPage('bookmarks'), ...shortcut('Ctrl+Shift+O') },
      { label: 'Downloads', click: () => actions.openPanel('downloads'), ...shortcut('Ctrl+J') }
    ],
    [
      {
        label: `Zoom (${actions.zoomPercent}%)`,
        enabled: actions.canZoom,
        submenu: [
          { label: 'Zoom in', click: () => actions.zoom(1), ...shortcut('Ctrl+=') },
          { label: 'Zoom out', click: () => actions.zoom(-1), ...shortcut('Ctrl+-') },
          { label: 'Reset to 100%', click: () => actions.zoom(0), ...shortcut('Ctrl+0') }
        ]
      },
      { label: 'Find in page…', enabled: actions.canZoom, click: actions.find, ...shortcut('Ctrl+F') },
      { label: 'Print…', enabled: actions.canZoom, click: actions.print, ...shortcut('Ctrl+P') }
    ],
    [
      { label: 'Show bookmarks bar', type: 'checkbox', checked: actions.showBookmarksBar, click: actions.toggleBookmarksBar, ...shortcut('Ctrl+Shift+B') },
      { label: actions.studyActive ? 'Study Mode (on)' : 'Study Mode', click: () => actions.openPanel('study') },
      { label: 'Focus insights', click: () => actions.openPanel('insights') }
    ],
    [
      { label: 'Clear browsing data…', click: actions.clearData, ...shortcut('Ctrl+Shift+Delete') },
      { label: 'Settings', click: () => actions.openPage('settings'), ...shortcut('Ctrl+,') }
    ],
    [{ label: 'Exit', click: actions.quit }]
  ]);
}

export type BookmarkMenuActions = {
  open: () => void;
  openInNewTab: () => void;
  edit: () => void;
  remove: () => void;
};

export function buildBookmarkMenu(actions: BookmarkMenuActions): MenuItemConstructorOptions[] {
  return joinSections([
    [
      { label: 'Open', click: actions.open },
      { label: 'Open in new tab', click: actions.openInNewTab }
    ],
    [
      { label: 'Edit…', click: actions.edit },
      { label: 'Delete', click: actions.remove }
    ]
  ]);
}

function joinSections(sections: MenuItemConstructorOptions[][]): MenuItemConstructorOptions[] {
  return sections
    .filter((section) => section.length > 0)
    .flatMap((section, index) => (index === 0 ? section : [{ type: 'separator' as const }, ...section]));
}
