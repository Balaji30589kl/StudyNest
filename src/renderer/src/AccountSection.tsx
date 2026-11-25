import { useEffect, useState } from 'react';
import type { AccountStateSnapshot, DiagnosticsSnapshot } from '../../shared/ipc.js';
import { formatClock } from './study-format.js';

type AccountSectionProps = {
  account: AccountStateSnapshot | null;
  diagnostics: DiagnosticsSnapshot | null;
  onUpdateProfile(profile: { displayName?: string; deviceName?: string }): void;
  onChooseFolder(): void;
  onDisableSync(): void;
  onToggleBrowsingDetails(include: boolean): void;
  onSyncNow(): void;
  onRefreshDiagnostics(): void;
};

export function AccountSection(props: AccountSectionProps) {
  const { account, diagnostics } = props;
  const [displayName, setDisplayName] = useState('');
  const [deviceName, setDeviceName] = useState('');

  useEffect(() => {
    if (account) {
      setDisplayName(account.profile.displayName);
      setDeviceName(account.device.name);
    }
  }, [account?.profile.displayName, account?.device.name]);

  if (!account) {
    return null;
  }

  const sync = account.sync;
  const profileDirty = displayName !== account.profile.displayName || deviceName !== account.device.name;

  return (
    <>
      <section className="side-section" aria-label="Profile and sync">
        <h3>Profile &amp; sync</h3>
        <label className="field">
          Name
          <input className="text-input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        </label>
        <label className="field">
          This device
          <input className="text-input" value={deviceName} onChange={(event) => setDeviceName(event.target.value)} />
        </label>
        <div className="settings-actions">
          <button type="button" disabled={!profileDirty} onClick={() => props.onUpdateProfile({ displayName, deviceName })}>
            Save profile
          </button>
        </div>

        <p className="muted small">
          Sync your rules and session history between devices through a folder you already sync (OneDrive, Dropbox, iCloud Drive). Your
          activity log, AI cache, and API keys never sync.
        </p>
        {sync.folder ? (
          <>
            <div className="sync-target" title={sync.folder}>{sync.folder}</div>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={sync.includeBrowsingDetails}
                onChange={(event) => props.onToggleBrowsingDetails(event.target.checked)}
              />
              <span>Include per-site focus times</span>
            </label>
            <p className={sync.lastError ? 'muted small warning-text' : 'muted small'}>
              {sync.syncing
                ? 'Syncing…'
                : sync.lastError
                  ? `Last sync failed: ${sync.lastError}`
                  : sync.lastSyncAt
                    ? `Last synced at ${formatClock(sync.lastSyncAt)}`
                    : 'Not synced yet'}
            </p>
            <div className="settings-actions">
              <button type="button" onClick={props.onDisableSync}>Turn off</button>
              <button type="button" className="primary" onClick={props.onSyncNow} disabled={sync.syncing}>Sync now</button>
            </div>
          </>
        ) : (
          <div className="settings-actions">
            <button type="button" className="primary" onClick={props.onChooseFolder}>Choose sync folder…</button>
          </div>
        )}
      </section>

      <section className="side-section" aria-label="About and diagnostics">
        <div className="side-section-header">
          <h3>About &amp; diagnostics</h3>
          <button type="button" className="link-button" onClick={props.onRefreshDiagnostics}>Refresh</button>
        </div>
        {diagnostics ? (
          <>
            <ul className="host-list">
              <li><span>StudyNest</span><span>{diagnostics.appVersion}</span></li>
              <li><span>Electron / Chromium</span><span>{diagnostics.electronVersion} / {diagnostics.chromeVersion.split('.')[0]}</span></li>
              <li><span>Platform</span><span>{diagnostics.platform}</span></li>
            </ul>
            <p className="muted small path-text" title={diagnostics.logFile}>Log: {diagnostics.logFile}</p>
            {diagnostics.recentProblems.length > 0 ? (
              <ol className="event-list">
                {diagnostics.recentProblems.map((problem, index) => (
                  <li key={`${problem.at}-${index}`} className="event event-warned">
                    <span className="event-time">{formatClock(problem.at)}</span>
                    <span className="event-label">{problem.message}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted small">No recent warnings or errors.</p>
            )}
          </>
        ) : null}
      </section>
    </>
  );
}
