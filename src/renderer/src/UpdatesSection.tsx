import type { UpdateState } from '../../shared/ipc.js';
import { formatClock } from './study-format.js';

type UpdatesSectionProps = {
  state: UpdateState | null;
  onCheck(): void;
  onInstall(): void;
};

function statusText(state: UpdateState): string {
  switch (state.status) {
    case 'disabled':
      return state.message ?? 'Automatic updates are off for this build.';
    case 'idle':
      return 'StudyNest checks for updates automatically.';
    case 'checking':
      return 'Checking for updates…';
    case 'up-to-date':
      return `You're up to date${state.lastCheckedAt ? ` · checked at ${formatClock(state.lastCheckedAt)}` : ''}.`;
    case 'downloading':
      return `Downloading version ${state.availableVersion ?? ''}… ${state.percent ?? 0}%`;
    case 'downloaded':
      return `Version ${state.availableVersion ?? ''} is ready. It installs when you restart StudyNest.`;
    case 'error':
      return state.message ?? "Couldn't check for updates.";
  }
}

export function UpdatesSection({ state, onCheck, onInstall }: UpdatesSectionProps) {
  if (!state) {
    return null;
  }
  const busy = state.status === 'checking' || state.status === 'downloading';

  return (
    <section className="side-section" aria-label="Updates">
      <div className="side-section-header">
        <h3>Updates</h3>
        <span className="muted small">Version {state.currentVersion}</span>
      </div>
      <p className={state.status === 'error' ? 'muted small warning-text' : 'muted small'} role="status">
        {statusText(state)}
      </p>
      {state.status === 'downloading' ? (
        <div className="study-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.percent ?? 0}>
          <span style={{ width: `${state.percent ?? 0}%` }} />
        </div>
      ) : null}
      {state.status !== 'disabled' ? (
        <div className="settings-actions">
          {state.status === 'downloaded' ? (
            <button type="button" className="primary" onClick={onInstall}>Restart to update</button>
          ) : (
            <button type="button" onClick={onCheck} disabled={busy}>Check for updates</button>
          )}
        </div>
      ) : null}
    </section>
  );
}
