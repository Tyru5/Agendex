import { getAgentLabel } from '../lib/agent-colors.ts';
import type { AgentStats } from '../lib/api.ts';
import { AgentIcon } from './AgentIcon.tsx';

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
      style={{ flexShrink: 0 }}
    >
      <circle cx="12" cy="3.5" r="0.9" fill="currentColor" opacity={0.9} />
      <path d="M12 4.75V6.25" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <rect
        x="5.25"
        y="6.75"
        width="13.5"
        height="10.75"
        rx="3.1"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="9.6" cy="11.1" r="1" fill="currentColor" />
      <circle cx="14.4" cy="11.1" r="1" fill="currentColor" />
      <path
        d="M9.5 14.2H14.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity={0.75}
      />
      <path
        d="M8 17.9V19.25M16 17.9V19.25"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
