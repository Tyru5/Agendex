import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentStats } from '../lib/api.ts';
import { getAgentLabel } from '../lib/agent-colors.ts';
import { AgentIcon } from './AgentIcon.tsx';

interface EmptyStateViewProps {
  onSearch?: () => void;
  onRescan?: () => Promise<void> | void;
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
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function RefreshIcon({ spinning }: { spinning?: boolean }) {
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
      style={spinning ? { animation: 'empty-state-spin 0.8s linear infinite' } : undefined}
    >
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 21h5v-5" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function ActionPill({
  icon,
  label,
  kbd,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  kbd?: string;
  onClick?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="inline-flex items-center gap-[7px] py-2 px-3.5 rounded-[10px] border border-border text-text text-[13px] font-medium font-[inherit] cursor-pointer transition-[background,border-color] duration-150"
      style={{
        background: hovered ? 'var(--hover)' : 'transparent',
        borderColor: hovered ? 'var(--active)' : undefined,
      }}
    >
      <span className="flex text-secondary">{icon}</span>
      {label}
      {kbd && (
        <span className="text-[10.5px] font-semibold tracking-[0.02em] py-0.5 px-1.5 rounded-[5px] bg-hover border border-border text-tertiary">
          {kbd}
        </span>
      )}
    </button>
  );
}

function SuggestionRow({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="w-full flex items-center gap-2.5 py-2.5 px-3.5 rounded-[10px] border border-border text-text text-[13px] font-[450] font-[inherit] transition-[background,border-color,opacity] duration-150"
      style={{
        background: hovered && !disabled ? 'var(--hover)' : 'transparent',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        borderColor: hovered && !disabled ? 'var(--active)' : undefined,
      }}
    >
      <span className="flex text-secondary shrink-0">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      <span className="flex text-tertiary shrink-0">
        <ChevronIcon />
      </span>
    </button>
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
    const id = setInterval(() => {
      setIndices((s) => ({ current: (s.current + 1) % count, prev: s.current }));
    }, 5000);
    return () => clearInterval(id);
  }, [count]);

  useEffect(() => {
    if (indices.prev === null) return;
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setIndices((s) => ({ ...s, prev: null })), 400);
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
  size = 16,
  currentAgent,
  prevAgent,
}: {
  size?: number;
  currentAgent: string;
  prevAgent: string | null;
}) {
  const dim = `${size}px`;

  return (
    <span className="inline-flex relative overflow-hidden" style={{ width: dim, height: dim }}>
      {prevAgent && (
        <span
          key={`out-${prevAgent}`}
          className="absolute inset-0 flex items-center justify-center"
          style={{ animation: 'rolodex-out 0.4s ease-in forwards' }}
        >
          <AgentIcon agent={prevAgent} size={size} />
        </span>
      )}
      <span
        key={`in-${currentAgent}`}
        className="absolute inset-0 flex items-center justify-center"
        style={{ animation: prevAgent ? 'rolodex-in 0.4s ease-out forwards' : undefined }}
      >
        <AgentIcon agent={currentAgent} size={size} />
      </span>
    </span>
  );
}

function RotatingText({ current, prev }: { current: string; prev: string | null }) {
  return (
    <span className="relative inline-flex overflow-hidden">
      {prev && (
        <span
          key={`text-out-${prev}`}
          className="absolute inset-0 whitespace-nowrap"
          style={{ animation: 'rolodex-out-inv 0.4s ease-in forwards' }}
        >
          {prev}
        </span>
      )}
      <span
        key={`text-in-${current}`}
        className="whitespace-nowrap"
        style={{ animation: prev ? 'rolodex-in-inv 0.4s ease-out forwards' : undefined }}
      >
        {current}
      </span>
    </span>
  );
}

export function EmptyStateView({
  onSearch,
  onRescan,
  planCount = 0,
  agents = EMPTY_AGENTS,
}: EmptyStateViewProps) {
  const [rescanning, setRescanning] = useState(false);
  const activeAgents = useMemo(() => agents.filter((a) => a.planCount > 0), [agents]);
  const activeAgentIds = useMemo(() => activeAgents.map((a) => a.agent), [activeAgents]);
  const { currentAgent, prevAgent } = useAgentRotation(activeAgentIds);

  const agentStats = currentAgent ? agents.find((a) => a.agent === currentAgent) : null;
  const prevAgentStats = prevAgent ? agents.find((a) => a.agent === prevAgent) : null;

  function agentLabel(agent: string, stats: AgentStats | null | undefined) {
    return stats && stats.planCount > 0
      ? `${stats.planCount} plans from ${getAgentLabel(agent)}`
      : `${getAgentLabel(agent)} plans`;
  }

  async function handleRescan() {
    if (rescanning || !onRescan) return;
    setRescanning(true);
    try {
      await onRescan();
    } finally {
      setRescanning(false);
    }
  }

  return (
    <div className="h-full flex items-center justify-center bg-bg">
      <div className="empty-state-content flex flex-col items-center text-center max-w-[420px] p-6 gap-4">
        <h2 className="text-[20px] font-semibold text-text m-0 tracking-[-0.02em]">
          What would you like to do?
        </h2>

        <p className="text-[13px] text-tertiary m-0 leading-[1.6]">
          {planCount === 0
            ? 'No plans detected yet. Start an AI agent or rescan.'
            : `${planCount} plans across ${activeAgents.length} agent${activeAgents.length !== 1 ? 's' : ''}`}
        </p>

        <div className="flex gap-2 flex-wrap justify-center">
          <ActionPill icon={<SearchIcon />} label="Search" kbd={`${modKey}+K`} onClick={onSearch} />
        </div>

        <div className="w-full flex flex-col gap-1.5 mt-1">
          {currentAgent && (
            <SuggestionRow
              icon={
                <RotatingAgentIcon size={16} currentAgent={currentAgent} prevAgent={prevAgent} />
              }
              label={
                <RotatingText
                  current={agentLabel(currentAgent, agentStats)}
                  prev={prevAgent ? agentLabel(prevAgent, prevAgentStats ?? null) : null}
                />
              }
              onClick={onSearch}
            />
          )}
          {planCount > 0 && (
            <SuggestionRow icon={<SearchIcon />} label="Search all plans" onClick={onSearch} />
          )}
          <SuggestionRow
            icon={<RefreshIcon spinning={rescanning} />}
            label={rescanning ? 'Scanning for plans...' : 'Rescan for new plans'}
            disabled={rescanning}
            onClick={handleRescan}
          />
        </div>

        <p className="text-[11px] text-tertiary mt-1">Press {modKey}+K to search anytime</p>
      </div>
    </div>
  );
}
