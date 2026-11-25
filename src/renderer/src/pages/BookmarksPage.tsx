import { ArrowDown, ArrowUp, Check, Pencil, Search, Star, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Bookmark } from '../../../shared/ipc.js';
import { hostLabel } from '../../../shared/url.js';
import { siteIconUrl } from '../components/BookmarksBar.js';
import { bridge, Favicon } from '../components/common.js';

type Props = {
  tabId: string;
  bookmarks: Bookmark[];
  /** "edit=<id>" from studynest://bookmarks#edit=<id> */
  section: string | null;
  onToast: (message: string, action?: { label: string; run: () => void }) => void;
};

export function BookmarksPage({ tabId, bookmarks, section, onToast }: Props) {
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: '', url: '' });

  const startEdit = (bookmark: Bookmark) => {
    setEditingId(bookmark.id);
    setDraft({ title: bookmark.title, url: bookmark.url });
  };

  useEffect(() => {
    const id = section?.startsWith('edit=') ? section.slice(5) : null;
    const bookmark = id ? bookmarks.find((entry) => entry.id === id) : undefined;
    if (bookmark) startEdit(bookmark);
  }, [section]);

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const visible = bookmarks.filter((bookmark) => words.every((word) => `${bookmark.title} ${bookmark.url}`.toLowerCase().includes(word)));

  const save = async () => {
    if (!editingId || !bridge) return;
    await bridge.updateBookmark(editingId, { title: draft.title, url: draft.url });
    setEditingId(null);
  };

  const remove = async (bookmark: Bookmark) => {
    if (!bridge) return;
    await bridge.removeBookmark(bookmark.id);
    onToast(`Removed “${bookmark.title}”`, { label: 'Undo', run: () => void bridge?.toggleBookmark(bookmark.url, bookmark.title) });
  };

  return (
    <div className="internal-page">
      <div className="page-wrap">
        <header className="page-header">
          <h1>Bookmarks</h1>
          <label className="page-search">
            <Search size={16} />
            <input aria-label="Search bookmarks" placeholder="Search bookmarks" value={query} onChange={(event) => setQuery(event.target.value)} autoFocus />
          </label>
        </header>

        <div className="page-toolbar">
          <span className="muted small">
            {bookmarks.length === 1 ? '1 bookmark' : `${bookmarks.length} bookmarks`} · shown in this order on the bookmarks bar
          </span>
        </div>

        {visible.length === 0 ? (
          <div className="list-card">
            <div className="empty-state">
              <Star size={28} />
              <strong>{query ? 'No matching bookmarks' : 'No bookmarks yet'}</strong>
              <span>{query ? 'Try a different word.' : 'Click the star in the address bar, or press Ctrl+D, to save a page.'}</span>
            </div>
          </div>
        ) : (
          <div className="list-card">
            {visible.map((bookmark) => {
              const index = bookmarks.indexOf(bookmark);
              const editing = editingId === bookmark.id;
              return (
                <div key={bookmark.id} className={editing ? 'list-row editing selected' : 'list-row'}>
                  <Favicon src={siteIconUrl(bookmark.url)} host={hostLabel(bookmark.url)} />
                  {editing ? (
                    <form
                      className="row-edit"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void save();
                      }}
                      onKeyDown={(event) => event.key === 'Escape' && setEditingId(null)}
                    >
                      <input aria-label="Bookmark name" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} autoFocus />
                      <input aria-label="Bookmark address" value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} />
                      <button type="submit" className="tool-button" aria-label="Save bookmark" title="Save">
                        <Check size={16} />
                      </button>
                      <button type="button" className="tool-button" aria-label="Cancel editing" title="Cancel" onClick={() => setEditingId(null)}>
                        <X size={16} />
                      </button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="list-row-main"
                        title={bookmark.url}
                        onClick={(event) => (event.ctrlKey ? void bridge?.newTab(bookmark.url) : void bridge?.navigate(bookmark.url, tabId))}
                        onAuxClick={(event) => event.button === 1 && void bridge?.newTab(bookmark.url)}
                      >
                        <span className="list-row-title">{bookmark.title}</span>
                        <span className="list-row-url">{bookmark.url.replace(/^https?:\/\/(www\.)?/, '')}</span>
                      </button>
                      <span className="list-row-actions">
                        {!query ? (
                          <>
                            <button type="button" className="tool-button" aria-label="Move up" title="Move up" disabled={index === 0} onClick={() => void bridge?.moveBookmark(bookmark.id, index - 1)}>
                              <ArrowUp size={15} />
                            </button>
                            <button
                              type="button"
                              className="tool-button"
                              aria-label="Move down"
                              title="Move down"
                              disabled={index === bookmarks.length - 1}
                              onClick={() => void bridge?.moveBookmark(bookmark.id, index + 1)}
                            >
                              <ArrowDown size={15} />
                            </button>
                          </>
                        ) : null}
                        <button type="button" className="tool-button" aria-label={`Edit ${bookmark.title}`} title="Edit" onClick={() => startEdit(bookmark)}>
                          <Pencil size={15} />
                        </button>
                        <button type="button" className="tool-button" aria-label={`Delete ${bookmark.title}`} title="Delete" onClick={() => void remove(bookmark)}>
                          <Trash2 size={15} />
                        </button>
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
