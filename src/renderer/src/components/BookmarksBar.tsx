import { useState } from 'react';
import type { Bookmark } from '../../../shared/ipc.js';
import { hostLabel } from '../../../shared/url.js';
import { bridge, Favicon } from './common.js';

/** Favicons for bookmarks come from the site itself (cached by the browser). */
export function siteIconUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? `${parsed.origin}/favicon.ico` : null;
  } catch {
    return null;
  }
}

export function BookmarksBar({ bookmarks, activeTabId }: { bookmarks: Bookmark[]; activeTabId: string | null }) {
  const [dragId, setDragId] = useState<string | null>(null);

  if (bookmarks.length === 0) {
    return (
      <div className="bookmarks-bar" aria-label="Bookmarks bar">
        <span className="bookmarks-bar-empty">
          Press <kbd>Ctrl</kbd> + <kbd>D</kbd> or the star in the address bar to save pages here.
        </span>
      </div>
    );
  }

  return (
    <div className="bookmarks-bar" aria-label="Bookmarks bar">
      {bookmarks.map((bookmark, index) => (
        <button
          key={bookmark.id}
          type="button"
          className="bookmark-chip"
          title={`${bookmark.title}\n${bookmark.url}`}
          draggable
          onDragStart={() => setDragId(bookmark.id)}
          onDragOver={(event) => dragId && event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (dragId && dragId !== bookmark.id) void bridge?.moveBookmark(dragId, index);
            setDragId(null);
          }}
          onDragEnd={() => setDragId(null)}
          onClick={(event) => {
            if (event.ctrlKey) void bridge?.newTab(bookmark.url);
            else void bridge?.navigate(bookmark.url, activeTabId ?? undefined);
          }}
          onAuxClick={(event) => event.button === 1 && void bridge?.newTab(bookmark.url)}
          onContextMenu={(event) => {
            event.preventDefault();
            void bridge?.showBookmarkMenu(bookmark.id);
          }}
        >
          <Favicon src={siteIconUrl(bookmark.url)} host={hostLabel(bookmark.url)} />
          <span>{bookmark.title}</span>
        </button>
      ))}
    </div>
  );
}
