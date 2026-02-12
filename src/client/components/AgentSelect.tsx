import type { AgentStats } from '../lib/api.ts';
import { AgentIcon } from './AgentIcon.tsx';
import { getAgentLabel } from '../lib/agent-colors.ts';

export function AgentSelect({
  agents,
  selected,
  onSelect,
}: {
  agents: AgentStats[];
  selected: string | undefined;
  onSelect: (agent: string | undefined) => void;
}) {
  const totalPlans = agents.reduce((sum, agent) => sum + agent.planCount, 0);
  const tabs = [
    {
      key: '__all__',
      label: 'All Agents',
      value: undefined as string | undefined,
      count: totalPlans,
    },
    ...agents
      .filter((agent) => agent.planCount > 0 || agent.agent === selected)
      .sort((a, b) => b.planCount - a.planCount || a.agent.localeCompare(b.agent))
      .map((agent) => ({
        key: agent.agent,
        value: agent.agent,
        label: getAgentLabel(agent.agent),
        count: agent.planCount,
      })),
  ];

  return (
    <div
      className="flex items-center min-w-0 max-w-[min(980px,62vw)] overflow-x-auto"
      style={{
        border: '1px solid var(--border)',
        background: 'var(--hover)',
        borderRadius: '12px',
        padding: '3px',
      }}
      role="tablist"
      aria-label="Filter plans by agent"
    >
      {tabs.map((tab) => {
        const active = tab.value === selected || (!tab.value && !selected);
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(tab.value)}
            style={{
              border: 'none',
              borderRadius: '9px',
              padding: '6px 14px',
              whiteSpace: 'nowrap',
              fontFamily: 'inherit',
              color: active ? 'var(--text)' : 'var(--secondary)',
              background: active ? 'var(--surface)' : 'transparent',
              cursor: 'pointer',
              transition: 'background 140ms ease, color 140ms ease',
              boxShadow: active ? '0 1px 0 rgba(0,0,0,0.03)' : 'none',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '3px',
              minWidth: '96px',
            }}
            title={`${tab.label} (${tab.count})`}
          >
            <span
              className="flex items-center gap-1.5"
              style={{
                fontSize: '12.5px',
                fontWeight: active ? 600 : 500,
                letterSpacing: '-0.01em',
                lineHeight: 1.1,
              }}
            >
              {tab.value ? <AgentIcon agent={tab.value} size={13} /> : <AllAgentsIcon />}
              {tab.label}
            </span>
            <span
              style={{
                fontSize: '10.5px',
                lineHeight: 1.1,
                color: active ? 'var(--secondary)' : 'var(--tertiary)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {tab.count} {tab.count === 1 ? 'plan' : 'plans'}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function AllAgentsIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={13}
      height={13}
      fill="none"
      aria-hidden="true"
      style={{ color: 'var(--secondary)', flexShrink: 0 }}
    >
      <path
        d="M7.5 10.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm9 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM4.25 17.5a3.25 3.25 0 0 1 6.5 0v.25h-6.5v-.25Zm9 0a3.25 3.25 0 0 1 6.5 0v.25h-6.5v-.25Z"
        fill="currentColor"
        opacity={0.7}
      />
    </svg>
  );
}
