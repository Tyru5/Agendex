import { useEffect, useMemo, useRef, useState } from 'react';
import { getAgentLabel } from '../lib/agent-colors.ts';
import type { AgentStats } from '../lib/api.ts';
import { AgentIcon } from './AgentIcon.tsx';

interface EmptyStateViewProps {
  onSearch?: () => void;
  planCount?: number;
  agents?: AgentStats[];
}

const EMPTY_AGENTS: AgentStats[] = [];

function SearchIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function ActionPill({
  icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="empty-state-pill empty-state-pill--accent"
    >
      <span className="empty-state-pill-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function StageCard({
  className,
  lines,
  active = false,
}: {
  className: string;
  lines: Array<'long' | 'mid' | 'short'>;
  active?: boolean;
}) {
  return (
    <div className={`${className}${active ? ' empty-state-stage-card--active' : ''}`}>
      <span className="empty-state-stage-chip" />
      <div className="empty-state-stage-lines">
        {lines.map((line) => (
          <span
            key={`${className}-${line}`}
            className={`empty-state-stage-line empty-state-stage-line--${line}`}
          />
        ))}
      </div>
    </div>
  );
}

function useAgentRotation(agentIds: string[]) {
  const [indices, setIndices] = useState<{ current: number; prev: number | null }>({
    current: 0,
    prev: null,
  });
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const count = agentIds.length;
  const agentKey = agentIds.join('\u001f');

  useEffect(() => {
    setIndices({ current: 0, prev: null });
  }, [agentKey]);

  useEffect(() => {
    if (count <= 1) return;
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }

    const id = setInterval(() => {
      setIndices((state) => ({ current: (state.current + 1) % count, prev: state.current }));
    }, 4200);

    return () => clearInterval(id);
  }, [count]);

  useEffect(() => {
    if (indices.prev === null) return;
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setIndices((state) => ({ ...state, prev: null }));
    }, 430);
    return () => clearTimeout(timeoutRef.current);
  }, [indices.prev]);

  const safeIndex = count > 0 ? indices.current % count : 0;
  const safePrev = indices.prev !== null && count > 0 ? indices.prev % count : null;

  return {
    currentAgent: agentIds[safeIndex] ?? null,
    prevAgent: safePrev !== null ? (agentIds[safePrev] ?? null) : null,
  };
}

function FlippingAgentSummary({
  currentAgent,
  currentText,
  prevAgent,
  prevText,
  widthCh,
}: {
  currentAgent: string;
  currentText: string;
  prevAgent: string | null;
  prevText: string | null;
  widthCh: number;
}) {
  return (
    <div
      className="empty-state-agent-note"
      style={{ '--empty-agent-summary-width': `${widthCh}ch` } as React.CSSProperties}
    >
      <span className="empty-state-agent-icon" aria-hidden="true">
        {prevAgent && (
          <span
            key={`agent-icon-out-${prevAgent}`}
            className="empty-state-agent-icon-layer empty-state-agent-icon-layer--out"
          >
            <AgentIcon agent={prevAgent} size={14} />
          </span>
        )}
        <span
          key={`agent-icon-in-${currentAgent}`}
          className={`empty-state-agent-icon-layer${prevAgent ? ' empty-state-agent-icon-layer--in' : ''}`}
        >
          <AgentIcon agent={currentAgent} size={14} />
        </span>
      </span>

      <span className="empty-state-agent-summary" aria-live="polite">
        {prevText && (
          <span
            key={`agent-summary-out-${prevText}`}
            className="empty-state-agent-summary-layer empty-state-agent-summary-layer--out"
          >
            {prevText}
          </span>
        )}
        <span
          key={`agent-summary-in-${currentText}`}
          className={`empty-state-agent-summary-layer${prevText ? ' empty-state-agent-summary-layer--in' : ''}`}
        >
          {currentText}
        </span>
      </span>
    </div>
  );
}

export function EmptyStateView({
  onSearch,
  planCount = 0,
  agents = EMPTY_AGENTS,
}: EmptyStateViewProps) {
  const activeAgents = useMemo(
    () => agents.filter((agent) => agent.planCount > 0).sort((a, b) => b.planCount - a.planCount),
    [agents],
  );
  const activeAgentIds = useMemo(() => activeAgents.map((agent) => agent.agent), [activeAgents]);
  const { currentAgent, prevAgent } = useAgentRotation(activeAgentIds);
  const currentAgentStats = currentAgent
    ? (activeAgents.find((agent) => agent.agent === currentAgent) ?? null)
    : null;
  const prevAgentStats = prevAgent
    ? (activeAgents.find((agent) => agent.agent === prevAgent) ?? null)
    : null;

  const hasPlans = planCount > 0;
  const heading = hasPlans ? 'Choose a plan' : 'No plans indexed';
  const description = hasPlans
    ? 'Search by title, source, or agent, or pick one from the sidebar.'
    : 'Plans from watched sources will appear here as soon as agents write them.';
  const planNoun = planCount === 1 ? 'plan' : 'plans';
  const status = hasPlans ? `${planCount} ${planNoun} indexed` : 'Plan index ready';

  function agentSummary(agent: string, stats: AgentStats | null) {
    const count = stats?.planCount ?? 0;
    const noun = count === 1 ? 'plan' : 'plans';
    return `${count} ${noun} from ${getAgentLabel(agent)}`;
  }

  const currentSummary =
    currentAgent && currentAgentStats ? agentSummary(currentAgent, currentAgentStats) : null;
  const prevSummary = prevAgent ? agentSummary(prevAgent, prevAgentStats) : null;
  const maxSummaryLength = Math.max(
    18,
    ...activeAgents.map((agent) => agentSummary(agent.agent, agent).length),
  );

  return (
    <div className="h-full empty-state-shell">
      <div className="empty-state-ambient" aria-hidden="true">
        <span className="empty-state-halo empty-state-halo--left" />
        <span className="empty-state-halo empty-state-halo--right" />
      </div>

      <div className="empty-state-content">
        <div className="empty-state-layout">
          <div className="empty-state-copy">
            <div className="empty-state-kicker">
              <span className="empty-state-kicker-dot" />
              <span>{status}</span>
            </div>

            <h2 className="empty-state-title">{heading}</h2>
            <p className="empty-state-description">{description}</p>

            {onSearch && hasPlans && (
              <div className="empty-state-actions">
                <ActionPill icon={<SearchIcon />} label="Search plans" onClick={onSearch} />
              </div>
            )}

            {currentAgent && currentSummary && (
              <FlippingAgentSummary
                currentAgent={currentAgent}
                currentText={currentSummary}
                prevAgent={prevAgent}
                prevText={prevSummary}
                widthCh={maxSummaryLength}
              />
            )}
          </div>

          <div className="empty-state-stage" aria-hidden="true">
            <div className={`empty-state-stage-shell${hasPlans ? ' is-populated' : ''}`}>
              <span className="empty-state-stage-beam" />
              <StageCard
                className="empty-state-stage-card empty-state-stage-card--back"
                lines={['long', 'mid']}
              />
              <StageCard
                className="empty-state-stage-card empty-state-stage-card--middle"
                lines={['long', 'short']}
                active={hasPlans}
              />
              <StageCard
                className="empty-state-stage-card empty-state-stage-card--front"
                lines={['long', 'mid', 'short']}
                active={hasPlans}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
