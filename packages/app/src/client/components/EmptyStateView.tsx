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
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '7px',
        padding: '8px 14px',
        borderRadius: '10px',
        border: '1px solid var(--border)',
        background: hovered ? 'var(--hover)' : 'transparent',
        color: 'var(--text)',
        fontSize: '13px',
        fontWeight: 500,
        fontFamily: 'inherit',
        cursor: 'pointer',
        transition: 'background 0.15s, border-color 0.15s',
        borderColor: hovered ? 'var(--active)' : undefined,
      }}
    >
      <span style={{ display: 'flex', color: 'var(--secondary)' }}>{icon}</span>
      {label}
      {kbd && (
        <span
          style={{
            fontSize: '10.5px',
            fontWeight: 600,
            letterSpacing: '0.02em',
            padding: '2px 6px',
            borderRadius: '5px',
            background: 'var(--hover)',
            border: '1px solid var(--border)',
            color: 'var(--tertiary)',
          }}
        >
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
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '10px 14px',
        borderRadius: '10px',
        border: '1px solid var(--border)',
        background: hovered && !disabled ? 'var(--hover)' : 'transparent',
        color: 'var(--text)',
        fontSize: '13px',
        fontWeight: 450,
        fontFamily: 'inherit',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        transition: 'background 0.15s, border-color 0.15s, opacity 0.15s',
        borderColor: hovered && !disabled ? 'var(--active)' : undefined,
      }}
    >
      <span style={{ display: 'flex', color: 'var(--secondary)', flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
      <span style={{ display: 'flex', color: 'var(--tertiary)', flexShrink: 0 }}>
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
    <span
      style={{
        display: 'inline-flex',
        width: dim,
        height: dim,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {prevAgent && (
        <span
          key={`out-${prevAgent}`}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            animation: 'rolodex-out 0.4s ease-in forwards',
          }}
        >
          <AgentIcon agent={prevAgent} size={size} />
        </span>
      )}
      <span
        key={`in-${currentAgent}`}
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          animation: prevAgent ? 'rolodex-in 0.4s ease-out forwards' : undefined,
        }}
      >
        <AgentIcon agent={currentAgent} size={size} />
      </span>
    </span>
  );
}

function RotatingText({ current, prev }: { current: string; prev: string | null }) {
  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-flex',
        overflow: 'hidden',
      }}
    >
      {prev && (
        <span
          key={`text-out-${prev}`}
          style={{
            position: 'absolute',
            inset: 0,
            animation: 'rolodex-out-inv 0.4s ease-in forwards',
            whiteSpace: 'nowrap',
          }}
        >
          {prev}
        </span>
      )}
      <span
        key={`text-in-${current}`}
        style={{
          animation: prev ? 'rolodex-in-inv 0.4s ease-out forwards' : undefined,
          whiteSpace: 'nowrap',
        }}
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
    <div className="h-full flex items-center justify-center" style={{ background: 'var(--bg)' }}>
      <div
        className="empty-state-content"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          maxWidth: '420px',
          padding: '24px',
          gap: '16px',
        }}
      >
        <h2
          style={{
            fontSize: '20px',
            fontWeight: 600,
            color: 'var(--text)',
            margin: 0,
            letterSpacing: '-0.02em',
          }}
        >
          What would you like to do?
        </h2>

        <p style={{ fontSize: '13px', color: 'var(--tertiary)', margin: 0, lineHeight: 1.6 }}>
          {planCount === 0
            ? 'No plans detected yet. Start an AI agent or rescan.'
            : `${planCount} plans across ${activeAgents.length} agent${activeAgents.length !== 1 ? 's' : ''}`}
        </p>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
          <ActionPill icon={<SearchIcon />} label="Search" kbd={`${modKey}+K`} onClick={onSearch} />
        </div>

        <div
          style={{
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            marginTop: '4px',
          }}
        >
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

        <p style={{ fontSize: '11px', color: 'var(--tertiary)', margin: '4px 0 0' }}>
          Press {modKey}+K to search anytime
        </p>
      </div>
    </div>
  );
}
