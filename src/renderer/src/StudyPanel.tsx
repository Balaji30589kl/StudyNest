import { useState } from 'react';
import type { AiStateSnapshot, StudyStateSnapshot } from '../../shared/ipc.js';
import { describeStudyEvent, focusRatio, formatClock, formatCountdown, formatDuration, formatElapsed, topHosts } from './study-format.js';

const DURATION_PRESETS = [15, 25, 45, 60, 90];

type StudyPanelProps = {
  state: StudyStateSnapshot | null;
  aiState: AiStateSnapshot | null;
  now: number;
  /** Minutes for a timed session, or null to switch Study Mode on without a timer. */
  onStart(durationMinutes: number | null): void;
  onStop(): void;
  onClearHistory(): void;
  onClose(): void;
};

function describeRulesSource(source: StudyStateSnapshot['policy']['source']): string {
  switch (source) {
    case 'gateway':
      return 'up to date from StudyNest';
    case 'gateway-cache':
      return 'saved copy from StudyNest';
    case 'bundled':
      return 'built into this version';
    case 'override':
      return 'development rules';
    case 'built-in':
      return 'minimal built-in rules';
  }
}

export function StudyPanel({ state, aiState, now, onStart, onStop, onClearHistory, onClose }: StudyPanelProps) {
  const [duration, setDuration] = useState(25);

  if (!state) {
    return (
      <aside className="side-panel" aria-label="Study Mode">
        <div className="side-panel-header">
          <h2>Study Mode</h2>
          <button type="button" className="ghost-button" onClick={onClose} aria-label="Close Study Mode panel">×</button>
        </div>
        <p className="muted">Open StudyNest through Electron to use Study Mode.</p>
      </aside>
    );
  }

  const session = state.session;
  const stats = state.stats;
  const timed = session?.endsAt != null;
  const remaining = session?.endsAt != null ? session.endsAt - now : 0;
  const progress =
    session?.endsAt != null ? Math.min(1, Math.max(0, (now - session.startedAt) / (session.endsAt - session.startedAt))) : 0;
  const ratio = focusRatio(stats);
  const hosts = topHosts(stats);
  const gatewayStatus = aiState?.gateway.status ?? 'unknown';

  return (
    <aside className="side-panel" aria-label="Study Mode">
      <div className="side-panel-header">
        <h2>Study Mode</h2>
        <button type="button" className="ghost-button" onClick={onClose} aria-label="Close Study Mode panel">×</button>
      </div>

      <section className={session ? 'study-card active' : 'study-card'}>
        {session ? (
          <>
            <div className="study-card-label">{timed ? 'Focus session in progress' : 'Study Mode is on'}</div>
            <div className="study-countdown" aria-live="polite">
              {timed ? formatCountdown(remaining) : formatElapsed(now - session.startedAt)}
            </div>
            {timed && session.endsAt !== null ? (
              <>
                <div className="study-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
                  <span style={{ width: `${progress * 100}%` }} />
                </div>
                <div className="study-card-meta">
                  {session.durationMinutes} min · ends at {formatClock(session.endsAt)}
                </div>
              </>
            ) : (
              <div className="study-card-meta">Started at {formatClock(session.startedAt)} · on until you turn it off</div>
            )}
            <button type="button" className="danger-button" onClick={onStop}>
              {timed ? 'End session' : 'Turn off Study Mode'}
            </button>
          </>
        ) : (
          <>
            <div className="study-card-label">Study Mode is off</div>
            <button type="button" className="primary-button" onClick={() => onStart(null)}>
              Turn on Study Mode
            </button>
            <div className="study-card-meta">Or start a timed session:</div>
            <div className="chip-row" role="radiogroup" aria-label="Session length">
              {DURATION_PRESETS.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  role="radio"
                  aria-checked={duration === minutes}
                  className={duration === minutes ? 'chip selected' : 'chip'}
                  onClick={() => setDuration(minutes)}
                >
                  {minutes}m
                </button>
              ))}
            </div>
            <button type="button" className="secondary-button" onClick={() => onStart(duration)}>
              Start {duration} min session
            </button>
          </>
        )}
      </section>

      <section className="side-section">
        <h3>{session ? 'This session' : 'Last session'}</h3>
        {stats ? (
          <>
            <div className="stat-grid">
              <div className="stat"><strong>{formatDuration(stats.focusedMs)}</strong><span>Focused</span></div>
              <div className="stat"><strong>{stats.blockedCount}</strong><span>Distractions blocked</span></div>
              <div className="stat"><strong>{ratio === null ? '—' : `${Math.round(ratio * 100)}%`}</strong><span>Focus ratio</span></div>
              <div className="stat"><strong>{stats.blockedByAi}</strong><span>Blocked by AI</span></div>
              <div className="stat"><strong>{stats.aiChecks}</strong><span>Pages checked</span></div>
              <div className="stat"><strong>{stats.focusLosses}</strong><span>Times left app</span></div>
            </div>
            {hosts.length > 0 ? (
              <ul className="host-list">
                {hosts.map((entry) => (
                  <li key={entry.host}><span>{entry.host}</span><span>{formatDuration(entry.ms)}</span></li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="muted">No sessions yet. Stats appear here once you start focusing.</p>
        )}
      </section>

      <section className="side-section" aria-label="How pages are checked">
        <h3>How pages are checked</h3>
        <ul className="rule-summary">
          <li><span className="rule-dot block" aria-hidden="true" />{state.policy.blockRules} sites are always blocked</li>
          <li><span className="rule-dot allow" aria-hidden="true" />{state.policy.allowRules} study sites are always allowed</li>
          <li>
            <span className="rule-dot ai" aria-hidden="true" />
            {state.policy.aiEnabled ? 'Everything else is checked by AI before it opens' : 'Other sites open normally'}
          </li>
        </ul>
        <p className="muted small">
          Rules are {describeRulesSource(state.policy.source)}.{' '}
          {gatewayStatus === 'offline'
            ? 'The AI service is unreachable, so offline keyword rules are used for now.'
            : gatewayStatus === 'online'
              ? 'AI checks are online.'
              : ''}
        </p>
      </section>

      <section className="side-section">
        <div className="side-section-header">
          <h3>Recent activity</h3>
          <button type="button" className="link-button" onClick={onClearHistory} disabled={state.recentEvents.length === 0}>
            Clear history
          </button>
        </div>
        {state.recentEvents.length > 0 ? (
          <ol className="event-list">
            {state.recentEvents.map((event) => (
              <li key={event.id} className={`event event-${event.type}`}>
                <span className="event-time">{formatClock(event.at)}</span>
                <span className="event-label">{describeStudyEvent(event)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">Activity during Study Mode is logged here. Nothing is recorded while it's off.</p>
        )}
      </section>
    </aside>
  );
}
