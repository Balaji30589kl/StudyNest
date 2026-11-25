import { useState } from 'react';
import type { DailyFocus, InsightsSnapshot } from '../../shared/insights.js';
import { formatDuration } from './study-format.js';

type InsightsPanelProps = {
  insights: InsightsSnapshot | null;
  onClose(): void;
};

const CHART_WIDTH = 344;
const CHART_HEIGHT = 120;
const AXIS_GAP = 18;
const BAR_GAP = 2;
const CORNER = 4;

function dayLabel(date: string, style: 'short' | 'long' = 'short'): string {
  const parsed = new Date(`${date}T12:00:00`);
  return style === 'short'
    ? parsed.toLocaleDateString([], { day: 'numeric' })
    : parsed.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatHour(hour: number): string {
  return new Date(2000, 0, 1, hour).toLocaleTimeString([], { hour: 'numeric' });
}

/** Bar with 4px rounded top corners, square and anchored at the baseline. */
function barPath(x: number, y: number, width: number, height: number): string {
  const r = Math.min(CORNER, width / 2, height);
  const bottom = y + height;
  return `M${x},${bottom} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${bottom} Z`;
}

function niceMax(ms: number): number {
  const minutes = Math.ceil(ms / 60000);
  const step = minutes <= 30 ? 10 : minutes <= 120 ? 30 : 60;
  return Math.max(step, Math.ceil(minutes / step) * step) * 60000;
}

function DailyChart({ daily }: { daily: DailyFocus[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const plotHeight = CHART_HEIGHT - AXIS_GAP;
  const max = niceMax(Math.max(0, ...daily.map((day) => day.focusedMs)));
  const slot = CHART_WIDTH / daily.length;
  const barWidth = Math.max(4, slot - BAR_GAP);
  const active = hovered === null ? null : daily[hovered];

  return (
    <div className="chart">
      <div className="chart-header">
        <h3>Daily focus time, last {daily.length} days</h3>
        <span className="chart-scale">max {formatDuration(max)}</span>
      </div>
      <div className="chart-plot" onMouseLeave={() => setHovered(null)}>
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          width="100%"
          role="img"
          aria-label={`Bar chart of daily focus time over the last ${daily.length} days`}
        >
          <line className="chart-grid" x1={0} x2={CHART_WIDTH} y1={0} y2={0} />
          <line className="chart-grid" x1={0} x2={CHART_WIDTH} y1={plotHeight / 2} y2={plotHeight / 2} />
          <line className="chart-baseline" x1={0} x2={CHART_WIDTH} y1={plotHeight} y2={plotHeight} />
          {daily.map((day, index) => {
            const height = day.focusedMs > 0 ? Math.max(2, (day.focusedMs / max) * plotHeight) : 0;
            const x = index * slot + BAR_GAP / 2;
            return (
              <g key={day.date}>
                {height > 0 ? (
                  <path
                    className={hovered === index ? 'chart-bar active' : 'chart-bar'}
                    d={barPath(x, plotHeight - height, barWidth, height)}
                  />
                ) : null}
                {/* Hit target spans the whole column, larger than the mark. */}
                <rect
                  className="chart-hit"
                  x={index * slot}
                  y={0}
                  width={slot}
                  height={plotHeight}
                  onMouseEnter={() => setHovered(index)}
                  onFocus={() => setHovered(index)}
                  onBlur={() => setHovered(null)}
                  tabIndex={0}
                  aria-label={`${dayLabel(day.date, 'long')}: ${formatDuration(day.focusedMs)}, ${day.sessions} sessions`}
                />
                {index % 2 === daily.length % 2 || index === daily.length - 1 ? (
                  <text className="chart-axis-label" x={index * slot + slot / 2} y={CHART_HEIGHT - 4} textAnchor="middle">
                    {dayLabel(day.date)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
        {active && hovered !== null ? (
          <div
            className="chart-tooltip"
            // Shift by the same fraction as the bar position so the tooltip always stays inside the panel.
            style={{
              left: `${((hovered + 0.5) / daily.length) * 100}%`,
              transform: `translate(-${((hovered + 0.5) / daily.length) * 100}%, 4px)`
            }}
            role="status"
          >
            <strong>{dayLabel(active.date, 'long')}</strong>
            <span>
              {formatDuration(active.focusedMs)} focused · {active.sessions} session{active.sessions === 1 ? '' : 's'}
            </span>
          </div>
        ) : null}
      </div>
      <details className="chart-table">
        <summary>View as table</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Focused</th>
              <th scope="col">Sessions</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((day) => (
              <tr key={day.date}>
                <td>{dayLabel(day.date, 'long')}</td>
                <td>{formatDuration(day.focusedMs)}</td>
                <td>{day.sessions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/** Read-only dashboard. It receives data and offers no browser controls. */
export function InsightsPanel({ insights, onClose }: InsightsPanelProps) {
  return (
    <aside className="side-panel" aria-label="Focus insights">
      <div className="side-panel-header">
        <h2>Focus insights</h2>
        <button type="button" className="ghost-button" onClick={onClose} aria-label="Close insights">×</button>
      </div>

      {!insights ? (
        <p className="muted">Loading…</p>
      ) : insights.totals.sessions === 0 ? (
        <p className="muted">Turn on Study Mode and finish a session to see your insights here.</p>
      ) : (
        <>
          <div className="stat-grid">
            <div className="stat"><strong>{formatDuration(insights.totals.focusedMs)}</strong><span>Total focus</span></div>
            <div className="stat"><strong>{insights.totals.sessions}</strong><span>Sessions</span></div>
            <div className="stat">
              <strong>{insights.totals.completionRate === null ? '—' : `${Math.round(insights.totals.completionRate * 100)}%`}</strong>
              <span>Timed sessions completed</span>
            </div>
            <div className="stat"><strong>{insights.currentStreakDays}d</strong><span>Current streak</span></div>
            <div className="stat"><strong>{insights.longestStreakDays}d</strong><span>Longest streak</span></div>
            <div className="stat">
              <strong>{insights.focusRatio === null ? '—' : `${Math.round(insights.focusRatio * 100)}%`}</strong>
              <span>Focus ratio</span>
            </div>
          </div>

          <section className="side-section">
            <DailyChart daily={insights.daily} />
          </section>

          <section className="side-section" aria-label="Distractions">
            <h3>Distractions</h3>
            <div className="stat-grid">
              <div className="stat"><strong>{insights.totals.blocked}</strong><span>Blocked in total</span></div>
              <div className="stat"><strong>{insights.totals.blockedByList}</strong><span>By block list</span></div>
              <div className="stat"><strong>{insights.totals.blockedByAi}</strong><span>By AI check</span></div>
            </div>
            <ul className="host-list">
              <li><span>Pages checked by AI</span><span>{insights.totals.aiChecks}</span></li>
              <li><span>Checked and allowed as study material</span><span>{insights.totals.aiAllowed}</span></li>
            </ul>
          </section>

          {insights.categories.length > 0 ? (
            <section className="side-section" aria-label="What AI saw">
              <h3>What the AI checks found</h3>
              <ul className="category-bars">
                {insights.categories.map((entry) => (
                  <li key={entry.category}>
                    <span className="category-name">{entry.category}</span>
                    <span className="category-track" aria-hidden="true">
                      <span style={{ width: `${(entry.count / insights.categories[0]!.count) * 100}%` }} />
                    </span>
                    <span className="category-count">{entry.count}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {insights.topBlockedHosts.length > 0 ? (
            <section className="side-section">
              <h3>Most blocked sites</h3>
              <ul className="host-list">
                {insights.topBlockedHosts.map((entry) => (
                  <li key={entry.host}><span>{entry.host}</span><span>{entry.count}×</span></li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="side-section">
            <h3>Patterns</h3>
            <ul className="host-list">
              <li><span>Average session</span><span>{insights.totals.averageSessionMs === null ? '—' : formatDuration(insights.totals.averageSessionMs)}</span></li>
              <li><span>Most focused start time</span><span>{insights.bestHour === null ? '—' : formatHour(insights.bestHour)}</span></li>
              <li><span>Pages visited while studying</span><span>{insights.totals.pagesVisited}</span></li>
            </ul>
          </section>

          {insights.topHosts.length > 0 ? (
            <section className="side-section">
              <h3>Where your focus time went</h3>
              <ul className="host-list">
                {insights.topHosts.map((entry) => (
                  <li key={entry.host}><span>{entry.host}</span><span>{formatDuration(entry.ms)}</span></li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </aside>
  );
}
