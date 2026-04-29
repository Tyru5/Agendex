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
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const modKey = isMac ? '\u2318' : 'Ctrl';

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
  kbd,
  onClick,
  disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  kbd?: string;
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
      {kbd && <span className="empty-state-pill-kbd">{kbd}</span>}
    </button>
  );
}

function StageCard({
  className,
  lines,
}: {
  className: string;
  lines: Array<'long' | 'mid' | 'short'>;
}) {
  return (
    <div className={className} data-empty-card>
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
    }, 360);
    return () => clearTimeout(timeoutRef.current);
  }, [indices.prev]);

  const safeIndex = count > 0 ? indices.current % count : 0;
  const safePrev = indices.prev !== null && count > 0 ? indices.prev % count : null;

  return {
    currentAgent: agentIds[safeIndex] ?? null,
    prevAgent: safePrev !== null ? (agentIds[safePrev] ?? null) : null,
  };
}

function RotatingAgentIcon({
  currentAgent,
  prevAgent,
}: {
  currentAgent: string;
  prevAgent: string | null;
}) {
  return (
    <span className="empty-state-agent-icon">
      {prevAgent && (
        <span
          key={`out-${prevAgent}`}
          className="empty-state-agent-icon-layer"
          style={{ animation: 'rolodex-out 0.36s ease-in forwards' }}
        >
          <AgentIcon agent={prevAgent} size={14} />
        </span>
      )}
      <span
        key={`in-${currentAgent}`}
        className="empty-state-agent-icon-layer"
        style={{ animation: prevAgent ? 'rolodex-in 0.36s ease-out forwards' : undefined }}
      >
        <AgentIcon agent={currentAgent} size={14} />
      </span>
    </span>
  );
}

function RotatingText({ current, prev }: { current: string; prev: string | null }) {
  return (
    <span className="empty-state-rotating-text">
      {prev && (
        <span
          key={`text-out-${prev}`}
          className="empty-state-rotating-text-layer empty-state-rotating-text-layer--out"
          style={{ animation: 'rolodex-out-inv 0.36s ease-in forwards' }}
        >
          {prev}
        </span>
      )}
      <span
        key={`text-in-${current}`}
        className="empty-state-rotating-text-layer"
        style={{ animation: prev ? 'rolodex-in-inv 0.36s ease-out forwards' : undefined }}
      >
        {current}
      </span>
    </span>
  );
}

export function EmptyStateView({
  onSearch,
  planCount = 0,
  agents = EMPTY_AGENTS,
}: EmptyStateViewProps) {
  const shellRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let disposed = false;
    let teardown = () => {};

    void import('gsap').then(({ gsap }) => {
      if (disposed || !shellRef.current) return;

      const shell = shellRef.current;
      const ctx = gsap.context(() => {
        const timeline = gsap.timeline({ defaults: { ease: 'power4.out' } });

        timeline
          .fromTo(
            '[data-empty-stage="ambient"]',
            { autoAlpha: 0 },
            { autoAlpha: 1, duration: 0.45 },
            0,
          )
          .fromTo(
            '[data-empty-animate="title"]',
            { autoAlpha: 0, y: 26 },
            { autoAlpha: 1, y: 0, duration: 0.58 },
            0.08,
          )
          .fromTo(
            '[data-empty-animate="description"]',
            { autoAlpha: 0, y: 20 },
            { autoAlpha: 1, y: 0, duration: 0.48 },
            0.16,
          )
          .fromTo(
            '[data-empty-animate="action"]',
            { autoAlpha: 0, y: 18 },
            { autoAlpha: 1, y: 0, duration: 0.42 },
            0.24,
          )
          .fromTo(
            '[data-empty-animate="agent"]',
            { autoAlpha: 0, y: 16 },
            { autoAlpha: 1, y: 0, duration: 0.42 },
            0.28,
          )
          .fromTo(
            '[data-empty-animate="stage"]',
            { autoAlpha: 0, x: 28 },
            { autoAlpha: 1, x: 0, duration: 0.62 },
            0.12,
          )
          .fromTo(
            '[data-empty-card]',
            { autoAlpha: 0, y: 24, scale: 0.985 },
            { autoAlpha: 1, y: 0, scale: 1, duration: 0.52, stagger: 0.07 },
            0.24,
          );
      }, shell);

      teardown = () => ctx.revert();
    });

    return () => {
      disposed = true;
      teardown();
    };
  }, []);

  const hasPlans = planCount > 0;
  const heading = hasPlans ? 'Pick a plan.' : 'No plans yet.';
  const description = hasPlans
    ? 'Open search and jump straight to what you need.'
    : 'Run an agent and Agendex will collect its plans here.';

  function agentSummary(agent: string, stats: AgentStats | null) {
    const count = stats?.planCount ?? 0;
    const noun = count === 1 ? 'plan' : 'plans';
    return `${count} ${noun} from ${getAgentLabel(agent)}`;
  }

  return (
    <div ref={shellRef} className="h-full empty-state-shell">
      <div className="empty-state-ambient" aria-hidden="true" data-empty-stage="ambient">
        <span className="empty-state-halo empty-state-halo--left" />
        <span className="empty-state-halo empty-state-halo--right" />
      </div>

      <div className="empty-state-content">
        <div className="empty-state-layout">
          <div className="empty-state-copy">
            <h2 className="empty-state-title" data-empty-animate="title">
              {heading}
            </h2>
            <p className="empty-state-description" data-empty-animate="description">
              {description}
            </p>

            {onSearch && (
              <div className="empty-state-actions" data-empty-animate="action">
                <ActionPill
                  icon={<SearchIcon />}
                  label={hasPlans ? 'Search plans' : 'Open search'}
                  kbd={`${modKey}+K`}
                  onClick={onSearch}
                />
              </div>
            )}

            {currentAgent && currentAgentStats && (
              <div className="empty-state-agent-note" data-empty-animate="agent">
                <RotatingAgentIcon currentAgent={currentAgent} prevAgent={prevAgent} />
                <RotatingText
                  current={agentSummary(currentAgent, currentAgentStats)}
                  prev={prevAgent ? agentSummary(prevAgent, prevAgentStats) : null}
                />
              </div>
            )}
          </div>

          <div className="empty-state-stage" aria-hidden="true" data-empty-animate="stage">
            <div className="empty-state-stage-shell">
              <span className="empty-state-stage-beam" />
              <StageCard
                className="empty-state-stage-card empty-state-stage-card--back"
                lines={['long', 'mid']}
              />
              <StageCard
                className="empty-state-stage-card empty-state-stage-card--middle"
                lines={['long', 'short']}
              />
              <StageCard
                className="empty-state-stage-card empty-state-stage-card--front"
                lines={['long', 'mid', 'short']}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
