import type { DownloadEntry } from '../../shared/ipc.js';

type DownloadsPanelProps = {
  downloads: DownloadEntry[];
  onOpen(id: string): void;
  onShow(id: string): void;
  onCancel(id: string): void;
  onClear(): void;
  onClose(): void;
};

export function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}

function describe(entry: DownloadEntry): string {
  switch (entry.state) {
    case 'progressing':
      return entry.totalBytes > 0
        ? `${formatBytes(entry.receivedBytes)} of ${formatBytes(entry.totalBytes)}`
        : `${formatBytes(entry.receivedBytes)} downloaded`;
    case 'completed':
      return `${formatBytes(entry.receivedBytes)} · ${entry.host || 'download'}`;
    case 'cancelled':
      return 'Cancelled';
    case 'interrupted':
      return 'Failed. Try downloading again';
  }
}

export function DownloadsPanel({ downloads, onOpen, onShow, onCancel, onClear, onClose }: DownloadsPanelProps) {
  const hasFinished = downloads.some((entry) => entry.state !== 'progressing');

  return (
    <aside className="side-panel" aria-label="Downloads">
      <div className="side-panel-header">
        <h2>Downloads</h2>
        <button type="button" className="ghost-button" onClick={onClose} aria-label="Close downloads">×</button>
      </div>

      {downloads.length === 0 ? (
        <p className="muted">Files you download in this session appear here.</p>
      ) : (
        <ul className="download-list">
          {downloads.map((entry) => {
            const progress = entry.totalBytes > 0 ? Math.min(1, entry.receivedBytes / entry.totalBytes) : null;
            return (
              <li key={entry.id} className={`download download-${entry.state}`}>
                <div className="download-name" title={entry.savePath ?? entry.filename}>{entry.filename}</div>
                <div className="download-meta">{describe(entry)}</div>
                {entry.state === 'progressing' ? (
                  <div
                    className={progress === null ? 'study-progress indeterminate' : 'study-progress'}
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress === null ? undefined : Math.round(progress * 100)}
                  >
                    <span style={{ width: progress === null ? '30%' : `${progress * 100}%` }} />
                  </div>
                ) : null}
                <div className="download-actions">
                  {entry.state === 'progressing' ? (
                    <button type="button" className="link-button" onClick={() => onCancel(entry.id)}>Cancel</button>
                  ) : null}
                  {entry.state === 'completed' ? (
                    <>
                      <button type="button" className="link-button" onClick={() => onOpen(entry.id)}>Open</button>
                      <button type="button" className="link-button" onClick={() => onShow(entry.id)}>Show in folder</button>
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {hasFinished ? (
        <div className="settings-actions">
          <button type="button" onClick={onClear}>Clear list</button>
        </div>
      ) : null}
    </aside>
  );
}
