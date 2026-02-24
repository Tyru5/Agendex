import { useState } from 'react';
import type { AgentStats } from '../lib/api.ts';
import { getAgentLabel } from '../lib/agent-colors.ts';
import { AgentIcon } from './AgentIcon.tsx';

interface EmptyStateViewProps {
  onSearch?: () => void;
  onRescan?: () => void;
  planCount?: number;
  agents?: AgentStats[];
}

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

function RefreshIcon() {
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
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
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
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '10px 14px',
        borderRadius: '10px',
        border: '1px solid var(--border)',
        background: hovered ? 'var(--hover)' : 'transparent',
        color: 'var(--text)',
        fontSize: '13px',
        fontWeight: 450,
        fontFamily: 'inherit',
        cursor: 'pointer',
        transition: 'background 0.15s, border-color 0.15s',
        borderColor: hovered ? 'var(--active)' : undefined,
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

export function EmptyStateView({
  onSearch,
  onRescan,
  planCount = 0,
  agents = [],
}: EmptyStateViewProps) {
  const topAgent =
    agents.length > 0 ? agents.reduce((a, b) => (b.planCount > a.planCount ? b : a)) : null;
  const activeAgentCount = agents.filter((a) => a.planCount > 0).length;

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
            : `${planCount} plans across ${activeAgentCount} agent${activeAgentCount !== 1 ? 's' : ''}`}
        </p>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
          <ActionPill icon={<SearchIcon />} label="Search" kbd={`${modKey}+K`} onClick={onSearch} />
          <ActionPill icon={<RefreshIcon />} label="Rescan" onClick={onRescan} />
        </div>

        {planCount > 0 && (
          <div
            style={{
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              marginTop: '4px',
            }}
          >
            {topAgent && topAgent.planCount > 0 && (
              <SuggestionRow
                icon={<AgentIcon agent={topAgent.agent} size={16} />}
                label={`View ${topAgent.planCount} plans from ${getAgentLabel(topAgent.agent)}`}
                onClick={onSearch}
              />
            )}
            <SuggestionRow icon={<SearchIcon />} label="Search all plans" onClick={onSearch} />
            <SuggestionRow icon={<RefreshIcon />} label="Rescan for new plans" onClick={onRescan} />
          </div>
        )}

        <p style={{ fontSize: '11px', color: 'var(--tertiary)', margin: '4px 0 0' }}>
          Press {modKey}+K to search anytime
        </p>
      </div>
    </div>
  );
}
