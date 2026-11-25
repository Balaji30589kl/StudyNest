import { Plus, ShieldAlert, Volume2, VolumeX, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { BrowserTabState } from '../../../shared/ipc.js';
import { internalPageOf } from '../../../shared/internal-pages.js';
import { displayUrl, hostLabel } from '../../../shared/url.js';
import { BrandMark, bridge, Favicon } from './common.js';

function TabIcon({ tab }: { tab: BrowserTabState }) {
  if (tab.isLoading) return <span className="tab-spinner" aria-label="Loading" />;
  if (tab.blocked) return <ShieldAlert className="favicon" size={16} strokeWidth={1.75} style={{ color: 'var(--danger)' }} aria-hidden="true" />;
  if (internalPageOf(tab.url)) return <BrandMark className="favicon" />;
  return <Favicon src={tab.favicon} host={hostLabel(tab.url)} />;
}

export function TabStrip({ tabs, activeTabId, onNewTab }: { tabs: BrowserTabState[]; activeTabId: string | null; onNewTab: () => void }) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; side: 'before' | 'after' } | null>(null);

  // Keep the active tab in view when there are more tabs than fit.
  useEffect(() => {
    rowRef.current?.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTabId, tabs.length]);

  const finishDrop = () => {
    if (dragId && drop && dragId !== drop.id) {
      const from = tabs.findIndex((tab) => tab.id === dragId);
      let to = tabs.findIndex((tab) => tab.id === drop.id) + (drop.side === 'after' ? 1 : 0);
      if (from < to) to -= 1;
      void bridge?.tabAction({ type: 'move', tabId: dragId, index: to });
    }
    setDragId(null);
    setDrop(null);
  };

  return (
    <div className="tab-strip" onDoubleClick={(event) => event.target === event.currentTarget && void bridge?.toggleMaximize()}>
      <div
        className="tabs-row"
        role="tablist"
        aria-label="Tabs"
        ref={rowRef}
        onWheel={(event) => {
          if (rowRef.current && Math.abs(event.deltaY) > Math.abs(event.deltaX)) rowRef.current.scrollLeft += event.deltaY;
        }}
      >
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          const classes = [
            'tab',
            active ? 'active' : '',
            tab.blocked ? 'blocked' : '',
            tab.pinned ? 'pinned' : '',
            dragId === tab.id ? 'dragging' : '',
            drop?.id === tab.id && dragId !== tab.id ? `drop-${drop.side}` : ''
          ]
            .filter(Boolean)
            .join(' ');
          const address = displayUrl(tab.url);
          return (
            <div
              key={tab.id}
              className={classes}
              title={address ? `${tab.title}\n${address}` : tab.title}
              draggable
              onDragStart={(event) => {
                setDragId(tab.id);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(event) => {
                if (!dragId) return;
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                setDrop({ id: tab.id, side: event.clientX < rect.left + rect.width / 2 ? 'before' : 'after' });
              }}
              onDrop={(event) => {
                event.preventDefault();
                finishDrop();
              }}
              onDragEnd={() => {
                setDragId(null);
                setDrop(null);
              }}
              onAuxClick={(event) => {
                if (event.button === 1 && !tab.pinned) void bridge?.closeTab(tab.id);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                void bridge?.showTabMenu(tab.id);
              }}
            >
              <button
                type="button"
                role="tab"
                className="tab-main"
                aria-selected={active}
                aria-current={active ? 'page' : undefined}
                aria-label={tab.pinned ? tab.title : undefined}
                onMouseDown={(event) => event.button === 0 && void bridge?.switchTab(tab.id)}
              >
                <TabIcon tab={tab} />
                {tab.pinned ? null : <span className="tab-title">{tab.title}</span>}
              </button>
              {!tab.pinned && (tab.audible || tab.muted) ? (
                <button
                  type="button"
                  className={tab.muted ? 'tab-audio muted' : 'tab-audio'}
                  aria-label={tab.muted ? 'Unmute tab' : 'Mute tab'}
                  title={tab.muted ? 'Unmute tab' : 'Mute tab'}
                  onClick={() => void bridge?.tabAction({ type: 'mute', tabId: tab.id })}
                >
                  {tab.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                </button>
              ) : null}
              {tab.pinned ? null : (
                <button type="button" className="tab-close" aria-label={`Close ${tab.title}`} title="Close tab (Ctrl+W)" onClick={() => void bridge?.closeTab(tab.id)}>
                  <X size={14} strokeWidth={2} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button type="button" className="new-tab-button" aria-label="New tab" title="New tab (Ctrl+T)" onClick={onNewTab}>
        <Plus size={18} strokeWidth={1.75} />
      </button>
      <div className="strip-spacer" onDoubleClick={() => void bridge?.toggleMaximize()} />
      <div className="window-controls">
        <button className="window-button" type="button" onClick={() => void bridge?.minimize()} aria-label="Minimize window" title="Minimize">
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 5.5h10" />
          </svg>
        </button>
        <button className="window-button" type="button" onClick={() => void bridge?.toggleMaximize()} aria-label="Maximize or restore window" title="Maximize">
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <rect x="0.5" y="0.5" width="9" height="9" />
          </svg>
        </button>
        <button className="window-button close" type="button" onClick={() => void bridge?.close()} aria-label="Close window" title="Close">
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 0l10 10M10 0L0 10" />
          </svg>
        </button>
      </div>
    </div>
  );
}
