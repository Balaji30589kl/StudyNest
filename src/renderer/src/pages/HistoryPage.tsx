import { Clock, Search, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { HistoryEntry } from '../../../shared/ipc.js';
import { siteIconUrl } from '../components/BookmarksBar.js';
import { bridge, Favicon } from '../components/common.js';

const PAGE_SIZE = 150;

function dayLabel(time: number, now: number): string {
  const day = new Date(time);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (time >= startOfToday) return 'Today';
  if (time >= startOfToday - 86_400_000) return 'Yesterday';
  return day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: day.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

function groupByDay(entries: HistoryEntry[]): Array<{ label: string; entries: HistoryEntry[] }> {
  const now = Date.now();
  const groups: Array<{ label: string; entries: HistoryEntry[] }> = [];
  for (const entry of entries) {
    const label = dayLabel(entry.visitedAt, now);
    const last = groups.at(-1);
    if (last && last.label === label) last.entries.push(entry);
    else groups.push({ label, entries: [entry] });
  }
  return groups;
}

export function HistoryPage({ tabId }: { tabId: string }) {
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(
    async (append: boolean) => {
      if (!bridge) return;
      const before = append ? entries.at(-1)?.visitedAt : undefined;
      const next = await bridge.queryHistory({ text: query, limit: PAGE_SIZE, before });
      setEntries((current) => (append ? [...current, ...next] : next));
      setHasMore(next.length === PAGE_SIZE);
      setLoaded(true);
    },
    [query, entries]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void load(false), 120);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const refresh = () => void load(false);
    window.addEventListener('studynest:history-changed', refresh);
    return () => window.removeEventListener('studynest:history-changed', refresh);
  }, [load]);

  const open = (url: string, newTab: boolean) => (newTab ? void bridge?.newTab(url) : void bridge?.navigate(url, tabId));

  return (
    <div className="internal-page">
      <div className="page-wrap">
        <header className="page-header">
          <h1>History</h1>
          <label className="page-search">
            <Search size={16} />
            <input aria-label="Search history" placeholder="Search history" value={query} onChange={(event) => setQuery(event.target.value)} autoFocus />
            {query ? (
              <button type="button" className="ghost-button" aria-label="Clear search" onClick={() => setQuery('')} style={{ width: 22, height: 22 }}>
                <X size={14} />
              </button>
            ) : null}
          </label>
        </header>

        <div className="page-toolbar">
          <span className="muted small">{query ? `Results for “${query}”` : 'Pages you visited in the last 180 days'}</span>
          <button type="button" className="button" onClick={() => void bridge?.navigate('studynest://settings#privacy', tabId)}>
            Clear browsing data…
          </button>
        </div>

        {loaded && entries.length === 0 ? (
          <div className="list-card">
            <div className="empty-state">
              <Clock size={28} />
              <strong>{query ? 'No matching pages' : 'No history yet'}</strong>
              <span>{query ? 'Try a different word or part of the address.' : 'Pages you visit will appear here.'}</span>
            </div>
          </div>
        ) : null}

        {groupByDay(entries).map((group) => (
          <section key={group.label}>
            <h2 className="list-group-title">{group.label}</h2>
            <div className="list-card">
              {group.entries.map((entry) => (
                <div key={entry.id} className="list-row">
                  <span className="list-row-time">{new Date(entry.visitedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  <Favicon src={siteIconUrl(entry.url)} host={entry.host} />
                  <button
                    type="button"
                    className="list-row-main"
                    title={entry.url}
                    onClick={(event) => open(entry.url, event.ctrlKey)}
                    onAuxClick={(event) => event.button === 1 && open(entry.url, true)}
                  >
                    <span className="list-row-title">{entry.title || entry.url}</span>
                    <span className="list-row-url">{entry.host}</span>
                  </button>
                  <span className="list-row-actions">
                    <button
                      type="button"
                      className="tool-button"
                      aria-label={`Remove ${entry.title || entry.url} from history`}
                      title="Remove from history"
                      onClick={() => {
                        setEntries((current) => current.filter((item) => item.id !== entry.id));
                        void bridge?.deleteHistory([entry.id]);
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </section>
        ))}

        {hasMore ? (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 20 }}>
            <button type="button" className="button" onClick={() => void load(true)}>
              Show more
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
