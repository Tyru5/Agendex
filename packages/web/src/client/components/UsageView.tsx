import { useEffect, useMemo, useRef, useState } from 'react';
import { getAgentColor, getAgentLabel } from '../lib/agent-colors.ts';
import { api, type UsageBucket, type UsageSummary } from '../lib/api.ts';
import { formatTokens, formatUsd } from '../lib/usage-format.ts';
import { AgentIcon } from './AgentIcon.tsx';

type Metric = 'cost' | 'tokens';
type Breakdown = 'model' | 'time';

const WINDOWS = [
  { days: 1, label: 'Past 24h' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
] as const;

const CHART_WIDTH = 640;
const CHART_HEIGHT = 220;
const CHART_PAD_TOP = 12;
const CHART_PAD_BOTTOM = 22;
const CHART_PAD_LEFT = 46;
const CHART_PAD_RIGHT = 8;

function formatShare(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

function formatDayLabel(day: string): string {
  const date = new Date(`${day}T00:00:00`);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatHourLabel(isoHour: string): string {
  const date = new Date(isoHour);
  return date.toLocaleTimeString(undefined, { hour: 'numeric' });
}

function formatBucketLabel(start: string, resolution: 'day' | 'hour'): string {
  return resolution === 'hour' ? formatHourLabel(start) : formatDayLabel(start);
}

/** Fill the requested window with zero buckets so charts are continuous. */
function fillBuckets(summary: UsageSummary): UsageBucket[] {
  const byStart = new Map(summary.buckets.map((b) => [b.start, b]));
  const filled: UsageBucket[] = [];
  const now = new Date(summary.generatedAt);

  if (summary.resolution === 'hour') {
    const cursor = new Date(now);
    cursor.setMinutes(0, 0, 0);
    cursor.setHours(cursor.getHours() - 23);
    for (let i = 0; i < 24; i++) {
      const start = cursor.toISOString();
      filled.push(byStart.get(start) ?? { start, costUsd: 0, totalTokens: 0, byAgent: {} });
      cursor.setHours(cursor.getHours() + 1);
    }
  } else {
    const cursor = new Date(now);
    cursor.setHours(0, 0, 0, 0);
    cursor.setDate(cursor.getDate() - (summary.days - 1));
    for (let i = 0; i < summary.days; i++) {
      const y = cursor.getFullYear();
      const m = String(cursor.getMonth() + 1).padStart(2, '0');
      const d = String(cursor.getDate()).padStart(2, '0');
      const start = `${y}-${m}-${d}`;
      filled.push(byStart.get(start) ?? { start, costUsd: 0, totalTokens: 0, byAgent: {} });
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  // Keep device-stamped cloud buckets that fall outside the viewer's local
  // calendar grid so timezone differences never hide existing usage.
  const seen = new Set(filled.map((bucket) => bucket.start));
  for (const bucket of summary.buckets) {
    if (!seen.has(bucket.start)) {
      filled.push(bucket);
      seen.add(bucket.start);
    }
  }
  return filled.sort((a, b) => a.start.localeCompare(b.start));
}

/** Round a maximum up to a "nice" 1/2/5 × 10ⁿ value for the Y scale. */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = Math.floor(Math.log10(value));
  const base = 10 ** power;
  for (const step of [1, 2, 5, 10]) {
    if (value <= step * base) return step * base;
  }
  return 10 * base;
}

/**
 * Monotone cubic interpolation (Fritsch–Carlson) so filled curves never
 * overshoot below zero or above peaks — same approach as t3code's chart.
 */
function monotonePath(points: { x: number; y: number }[]): string {
  const n = points.length;
  if (n === 0) return '';
  if (n === 1) return `M${points[0]!.x},${points[0]!.y}`;

  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(points[i + 1]!.x - points[i]!.x);
    slope.push((points[i + 1]!.y - points[i]!.y) / (dx[i]! || 1));
  }
  const m: number[] = [slope[0]!];
  for (let i = 1; i < n - 1; i++) {
    const s0 = slope[i - 1]!;
    const s1 = slope[i]!;
    m.push(
      s0 * s1 <= 0
        ? 0
        : (3 * (dx[i - 1]! + dx[i]!)) /
            ((2 * dx[i]! + dx[i - 1]!) / s0 + (dx[i]! + 2 * dx[i - 1]!) / s1),
    );
  }
  m.push(slope[n - 2]!);

  let d = `M${points[0]!.x},${points[0]!.y}`;
  for (let i = 0; i < n - 1; i++) {
    const x0 = points[i]!.x;
    const y0 = points[i]!.y;
    const x1 = points[i + 1]!.x;
    const y1 = points[i + 1]!.y;
    const h = dx[i]! / 3;
    d += `C${x0 + h},${y0 + m[i]! * h} ${x1 - h},${y1 - m[i + 1]! * h} ${x1},${y1}`;
  }
  return d;
}

interface ChartHover {
  index: number;
  clientX: number;
}

function UsageChart({
  summary,
  buckets,
  metric,
}: {
  summary: UsageSummary;
  buckets: UsageBucket[];
  metric: Metric;
}) {
  const [hover, setHover] = useState<ChartHover | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const agents = summary.agents.map((a) => a.agent);
  const valueOf = (bucket: UsageBucket, agent?: string): number => {
    if (agent) {
      const entry = bucket.byAgent[agent];
      return entry ? (metric === 'cost' ? entry.costUsd : entry.totalTokens) : 0;
    }
    return metric === 'cost' ? bucket.costUsd : bucket.totalTokens;
  };

  const innerWidth = CHART_WIDTH - CHART_PAD_LEFT - CHART_PAD_RIGHT;
  const innerHeight = CHART_HEIGHT - CHART_PAD_TOP - CHART_PAD_BOTTOM;
  const maxValue = niceMax(Math.max(...buckets.map((b) => valueOf(b)), 0));
  const baseY = CHART_PAD_TOP + innerHeight;

  const xAt = (index: number) =>
    CHART_PAD_LEFT + (buckets.length <= 1 ? 0 : (index / (buckets.length - 1)) * innerWidth);
  const yAt = (value: number) => baseY - (value / maxValue) * innerHeight;

  const ticks = [0.25, 0.5, 0.75, 1].map((f) => f * maxValue);
  const formatTick = (v: number) => (metric === 'cost' ? formatUsd(v) : formatTokens(v));

  const handleMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || buckets.length === 0) return;
    const fx = ((event.clientX - rect.left) / rect.width) * CHART_WIDTH;
    const ratio = Math.min(1, Math.max(0, (fx - CHART_PAD_LEFT) / innerWidth));
    setHover({
      index: Math.round(ratio * (buckets.length - 1)),
      clientX: event.clientX - rect.left,
    });
  };

  const hovered = hover === null ? null : buckets[hover.index];

  return (
    <div className="usage-chart">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="usage-chart-svg"
        role="img"
        aria-label={`${summary.resolution === 'hour' ? 'Hourly' : 'Daily'} ${metric} per agent`}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={CHART_PAD_LEFT}
              x2={CHART_WIDTH - CHART_PAD_RIGHT}
              y1={yAt(tick)}
              y2={yAt(tick)}
              className="usage-chart-grid"
            />
            <text
              x={CHART_PAD_LEFT - 6}
              y={yAt(tick) + 3}
              className="usage-chart-tick"
              textAnchor="end"
            >
              {formatTick(tick)}
            </text>
          </g>
        ))}
        <line
          x1={CHART_PAD_LEFT}
          x2={CHART_WIDTH - CHART_PAD_RIGHT}
          y1={baseY}
          y2={baseY}
          className="usage-chart-axis"
        />

        {/* Each agent is an independent zero-baseline filled line, not stacked. */}
        {agents.map((agent) => {
          const points = buckets.map((bucket, i) => ({
            x: xAt(i),
            y: yAt(valueOf(bucket, agent)),
          }));
          const line = monotonePath(points);
          if (!line) return null;
          const area = `${line}L${xAt(buckets.length - 1)},${baseY}L${xAt(0)},${baseY}Z`;
          const color = getAgentColor(agent);
          return (
            <g key={agent}>
              <path d={area} fill={color} opacity={0.14} />
              <path
                d={line}
                fill="none"
                stroke={color}
                strokeWidth={1.6}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}

        {hover !== null && (
          <line
            x1={xAt(hover.index)}
            x2={xAt(hover.index)}
            y1={CHART_PAD_TOP}
            y2={baseY}
            className="usage-chart-hover-line"
          />
        )}

        {buckets.length > 0 && (
          <>
            <text x={CHART_PAD_LEFT} y={CHART_HEIGHT - 6} className="usage-chart-tick">
              {formatBucketLabel(buckets[0]!.start, summary.resolution)}
            </text>
            <text
              x={CHART_WIDTH - CHART_PAD_RIGHT}
              y={CHART_HEIGHT - 6}
              className="usage-chart-tick"
              textAnchor="end"
            >
              {formatBucketLabel(buckets[buckets.length - 1]!.start, summary.resolution)}
            </text>
            {buckets.length > 2 && (
              <text
                x={xAt((buckets.length - 1) / 2)}
                y={CHART_HEIGHT - 6}
                className="usage-chart-tick"
                textAnchor="middle"
              >
                {formatBucketLabel(
                  buckets[Math.floor((buckets.length - 1) / 2)]!.start,
                  summary.resolution,
                )}
              </text>
            )}
          </>
        )}
      </svg>

      {hover !== null && hovered && (
        <div
          className="usage-chart-tooltip"
          style={{ left: `${Math.min(Math.max(hover.clientX, 70), 999)}px` }}
        >
          <div className="usage-chart-tooltip-title">
            {formatBucketLabel(hovered.start, summary.resolution)}
          </div>
          {agents.map((agent) => (
            <div key={agent} className="usage-chart-tooltip-row">
              <span
                className="usage-chart-tooltip-dot"
                style={{ background: getAgentColor(agent) }}
              />
              <span className="usage-chart-tooltip-name">{getAgentLabel(agent)}</span>
              <span className="usage-chart-tooltip-value">
                {metric === 'cost'
                  ? formatUsd(hovered.byAgent[agent]?.costUsd ?? 0)
                  : formatTokens(hovered.byAgent[agent]?.totalTokens ?? 0)}
              </span>
            </div>
          ))}
          <div className="usage-chart-tooltip-row usage-chart-tooltip-total">
            <span className="usage-chart-tooltip-name">Total</span>
            <span className="usage-chart-tooltip-value">
              {metric === 'cost' ? formatUsd(hovered.costUsd) : formatTokens(hovered.totalTokens)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export interface UsageViewProps {
  onBack?: () => void;
  /** Pre-fetched 30-day summary so the initial render has data. */
  initialSummary?: UsageSummary | null;
  loadUsage?: UsageLoader;
}

export type UsageLoader = (days?: number, refresh?: boolean) => Promise<UsageSummary | null>;

export function UsageView({ onBack, initialSummary, loadUsage = api.getUsage }: UsageViewProps) {
  const [days, setDays] = useState(initialSummary?.days ?? 30);
  const [metric, setMetric] = useState<Metric>('cost');
  const [breakdown, setBreakdown] = useState<Breakdown>('model');
  const [loading, setLoading] = useState(false);
  const [summaries, setSummaries] = useState<Record<number, UsageSummary>>(() =>
    initialSummary ? { [initialSummary.days]: initialSummary } : {},
  );
  // Shared loading flag across window fetches and refresh — count outstanding
  // requests so cancelling one (window switch) never clears busy while another
  // is still running, and so a cancelled fetch still releases the counter.
  const inflightRef = useRef(0);

  useEffect(() => {
    if (!initialSummary) return;
    setSummaries((prev) => ({ ...prev, [initialSummary.days]: initialSummary }));
  }, [initialSummary]);

  const beginLoad = () => {
    inflightRef.current += 1;
    setLoading(true);
  };
  const endLoad = () => {
    inflightRef.current = Math.max(0, inflightRef.current - 1);
    if (inflightRef.current === 0) setLoading(false);
  };

  const summary = summaries[days] ?? null;

  useEffect(() => {
    if (summaries[days]) return;
    let cancelled = false;
    beginLoad();
    loadUsage(days)
      .then((result) => {
        if (!cancelled && result) setSummaries((prev) => ({ ...prev, [days]: result }));
      })
      .catch(() => {
        // Endpoint unavailable: leave the view in its empty state.
      })
      .finally(() => {
        endLoad();
      });
    return () => {
      cancelled = true;
    };
  }, [days, loadUsage, summaries]);

  const refresh = () => {
    beginLoad();
    loadUsage(days, true)
      .then((result) => {
        if (result) setSummaries((prev) => ({ ...prev, [days]: result }));
      })
      .catch(() => {})
      .finally(() => endLoad());
  };

  const buckets = useMemo(() => (summary ? fillBuckets(summary) : []), [summary]);
  const timeRows = useMemo(() => [...buckets].reverse(), [buckets]);

  const byCost = (summary?.costUsd ?? 0) > 0;
  const headlineValue = summary
    ? metric === 'cost'
      ? formatUsd(summary.costUsd)
      : `${formatTokens(summary.totalTokens)} tokens`
    : '—';

  const models = useMemo(() => {
    if (!summary) return [];
    return metric === 'tokens'
      ? [...summary.models].sort((a, b) => b.totalTokens - a.totalTokens)
      : summary.models;
  }, [summary, metric]);

  return (
    <div className="usage-view" aria-busy={loading}>
      <header className="usage-view-head">
        <div className="usage-view-head-left">
          {onBack && (
            <button type="button" className="empty-state-agent-back" onClick={onBack}>
              ← Back
            </button>
          )}
          <h2 className="usage-view-title">Usage</h2>
          {summary && (
            <span className="usage-view-range">
              {formatDayLabel(buckets[0]?.start.slice(0, 10) ?? '')} to{' '}
              {formatDayLabel(buckets[buckets.length - 1]?.start.slice(0, 10) ?? '')}
            </span>
          )}
        </div>
        <div className="usage-view-controls">
          <div className="usage-toggle" role="group" aria-label="Metric">
            {(['cost', 'tokens'] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={`usage-toggle-option${metric === m ? ' usage-toggle-option--active' : ''}`}
                onClick={() => setMetric(m)}
                aria-pressed={metric === m}
              >
                {m === 'cost' ? 'Cost' : 'Tokens'}
              </button>
            ))}
          </div>
          <div className="usage-toggle" role="group" aria-label="Time window">
            {WINDOWS.map((w) => (
              <button
                key={w.days}
                type="button"
                className={`usage-toggle-option${days === w.days ? ' usage-toggle-option--active' : ''}`}
                onClick={() => setDays(w.days)}
                aria-pressed={days === w.days}
              >
                {w.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="usage-refresh"
            onClick={refresh}
            disabled={loading}
            aria-label="Refresh usage"
            title="Refresh usage"
          >
            ⟳
          </button>
        </div>
      </header>

      {!summary ? (
        <p className="usage-view-empty">
          {loading ? 'Scanning agent transcripts…' : 'No usage data available.'}
        </p>
      ) : (
        <>
          <section className="usage-summary">
            <div className="usage-headline">
              <div className="usage-headline-value">{headlineValue}</div>
              <div className="usage-headline-meta">
                {summary.sessions.toLocaleString()}{' '}
                {summary.sessions === 1 ? 'session' : 'sessions'}
                {metric === 'cost' && byCost && ' · API estimate'}
              </div>

              <ul className="usage-agent-list">
                {summary.agents.map((agent) => {
                  const costShare = summary.costUsd > 0 ? agent.costUsd / summary.costUsd : 0;
                  const tokenShare =
                    summary.totalTokens > 0 ? agent.totalTokens / summary.totalTokens : 0;
                  return (
                    <li key={agent.agent} className="usage-agent-row">
                      <span
                        className="usage-agent-dot"
                        style={{ background: getAgentColor(agent.agent) }}
                        aria-hidden="true"
                      />
                      <span className="usage-agent-icon" aria-hidden="true">
                        <AgentIcon agent={agent.agent} size={14} />
                      </span>
                      <span className="usage-agent-name">
                        {getAgentLabel(agent.agent)}
                        <span className="usage-agent-sessions">
                          {agent.sessions.toLocaleString()}{' '}
                          {agent.sessions === 1 ? 'session' : 'sessions'}
                        </span>
                      </span>
                      <span className="usage-agent-amount">
                        {metric === 'cost'
                          ? formatUsd(agent.costUsd)
                          : formatTokens(agent.totalTokens)}
                      </span>
                      <span className="usage-agent-share">
                        {metric === 'cost'
                          ? `${formatShare(costShare)} of cost · ${formatTokens(agent.totalTokens)} tokens`
                          : `${formatShare(tokenShare)} of tokens · ${formatUsd(agent.costUsd)}`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="usage-chart-panel">
              <h3 className="usage-section-title">
                {summary.resolution === 'hour' ? 'Hourly' : 'Daily'}{' '}
                {metric === 'cost' ? 'cost' : 'tokens'}
              </h3>
              <UsageChart summary={summary} buckets={buckets} metric={metric} />
            </div>
          </section>

          <section>
            <h3 className="usage-section-title">Totals</h3>
            <div className="usage-totals">
              <div className="usage-total">
                <span className="usage-total-label">Processed tokens</span>
                <span className="usage-total-value">{formatTokens(summary.totalTokens)}</span>
              </div>
              <div className="usage-total">
                <span className="usage-total-label">Cached input</span>
                <span className="usage-total-value">
                  {formatTokens(summary.totals.cachedInputTokens)}
                </span>
              </div>
              <div className="usage-total">
                <span className="usage-total-label">Uncached input</span>
                <span className="usage-total-value">
                  {formatTokens(summary.totals.uncachedInputTokens)}
                </span>
              </div>
              <div className="usage-total">
                <span className="usage-total-label">Output</span>
                <span className="usage-total-value">
                  {formatTokens(summary.totals.outputTokens)}
                </span>
              </div>
              <div className="usage-total">
                <span className="usage-total-label">Cache savings</span>
                <span className="usage-total-value">{formatUsd(summary.cacheSavingsUsd)}</span>
              </div>
            </div>
          </section>

          <section>
            <div className="usage-breakdown-head">
              <h3 className="usage-section-title">Breakdown</h3>
              <div className="usage-toggle" role="group" aria-label="Breakdown">
                {(['model', 'time'] as const).map((b) => (
                  <button
                    key={b}
                    type="button"
                    className={`usage-toggle-option${breakdown === b ? ' usage-toggle-option--active' : ''}`}
                    onClick={() => setBreakdown(b)}
                    aria-pressed={breakdown === b}
                  >
                    {b === 'model' ? 'Model' : summary.resolution === 'hour' ? 'Hour' : 'Day'}
                  </button>
                ))}
              </div>
            </div>

            {breakdown === 'model' ? (
              <table className="usage-table">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th className="usage-table-num">Cost</th>
                    <th className="usage-table-num">Share</th>
                    <th className="usage-table-num">Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((model) => {
                    const share =
                      metric === 'cost'
                        ? summary.costUsd > 0
                          ? model.costUsd / summary.costUsd
                          : 0
                        : summary.totalTokens > 0
                          ? model.totalTokens / summary.totalTokens
                          : 0;
                    return (
                      <tr key={`${model.agent}-${model.model}`}>
                        <td>
                          <span className="usage-table-model">
                            <AgentIcon agent={model.agent} size={13} />
                            {model.model}
                          </span>
                        </td>
                        <td className="usage-table-num">{formatUsd(model.costUsd)}</td>
                        <td className="usage-table-num">{formatShare(share)}</td>
                        <td className="usage-table-num">{formatTokens(model.totalTokens)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <table className="usage-table">
                <thead>
                  <tr>
                    <th>{summary.resolution === 'hour' ? 'Hour' : 'Day'}</th>
                    {summary.agents.map((agent) => (
                      <th key={agent.agent} className="usage-table-num">
                        {getAgentLabel(agent.agent)}
                      </th>
                    ))}
                    <th className="usage-table-num">Total</th>
                    <th className="usage-table-num">Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {timeRows.map((bucket) => (
                    <tr key={bucket.start}>
                      <td>{formatBucketLabel(bucket.start, summary.resolution)}</td>
                      {summary.agents.map((agent) => (
                        <td key={agent.agent} className="usage-table-num">
                          {metric === 'cost'
                            ? formatUsd(bucket.byAgent[agent.agent]?.costUsd ?? 0)
                            : formatTokens(bucket.byAgent[agent.agent]?.totalTokens ?? 0)}
                        </td>
                      ))}
                      <td className="usage-table-num">
                        {metric === 'cost'
                          ? formatUsd(bucket.costUsd)
                          : formatTokens(bucket.totalTokens)}
                      </td>
                      <td className="usage-table-num">{formatTokens(bucket.totalTokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {summary.unpricedRecords > 0 && (
            <p className="usage-view-footnote">
              {summary.unpricedRecords.toLocaleString()} records could not be priced; their tokens
              are counted but contribute no cost.
            </p>
          )}
        </>
      )}
    </div>
  );
}
