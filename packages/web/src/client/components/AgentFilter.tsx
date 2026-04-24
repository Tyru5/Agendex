import { useMemo, useState } from 'react';
import { getAgentLabel } from '../lib/agent-colors.ts';
import type { AgentStats } from '../lib/api.ts';
import { AgentIcon } from './AgentIcon.tsx';

const VISIBLE_AGENT_COUNT = 5;

export function AgentFilter({
  agents,
  selected,
  onSelect,
}: {
  agents: AgentStats[];
  selected: string | undefined;
  onSelect: (agent: string | undefined) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const totalPlans = agents.reduce((sum, agent) => sum + agent.planCount, 0);

  const { visibleAgents, overflowAgents } = useMemo(() => {
    const sorted = agents
      .filter((agent) => agent.planCount > 0)
      .sort((a, b) => {
        if (b.planCount !== a.planCount) return b.planCount - a.planCount;
        return getAgentLabel(a.agent).localeCompare(getAgentLabel(b.agent));
      });

    const topAgents = sorted.slice(0, VISIBLE_AGENT_COUNT);
    const visibleIds = new Set(topAgents.map((agent) => agent.agent));
    const selectedStat = selected ? agents.find((agent) => agent.agent === selected) : undefined;
    const selectedHidden =
      selectedStat && !visibleIds.has(selectedStat.agent) ? selectedStat : undefined;
    const baseVisible = selectedHidden ? [...topAgents, selectedHidden] : topAgents;
    const baseVisibleIds = new Set(baseVisible.map((agent) => agent.agent));

    return {
      visibleAgents: baseVisible,
      overflowAgents: sorted.filter((agent) => !baseVisibleIds.has(agent.agent)),
    };
  }, [agents, selected]);

  return (
    <div className="sidebar-control-block">
      <div className="sidebar-control-header">
        <span className="sidebar-control-label">Agents</span>
        {overflowAgents.length > 0 && (
          <span className="sidebar-count-pill">+{overflowAgents.length}</span>
        )}
      </div>
      <div className="sidebar-agent-tray">
        <AgentButton
          agent={undefined}
          label="All plans"
          count={totalPlans}
          active={!selected}
          onClick={() => onSelect(undefined)}
        />
        {visibleAgents.map((agent) => (
          <AgentButton
            key={agent.agent}
            agent={agent.agent}
            label={getAgentLabel(agent.agent)}
            count={agent.planCount}
            active={agent.agent === selected}
            onClick={() => onSelect(agent.agent === selected ? undefined : agent.agent)}
          />
        ))}

        {expanded &&
          overflowAgents.map((agent) => (
            <AgentButton
              key={agent.agent}
              agent={agent.agent}
              label={getAgentLabel(agent.agent)}
              count={agent.planCount}
              active={agent.agent === selected}
              onClick={() => onSelect(agent.agent === selected ? undefined : agent.agent)}
            />
          ))}

        {overflowAgents.length > 0 && (
          <button
            type="button"
            className="sidebar-compact-row sidebar-compact-row--subtle"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            <span className="sidebar-compact-label">
              {expanded ? 'Show fewer agents' : `More agents · ${overflowAgents.length}`}
            </span>
            <svg
              aria-hidden="true"
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ transform: expanded ? 'rotate(180deg)' : undefined }}
            >
              <path d="m4 6 4 4 4-4" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

function AgentButton({
  agent,
  label,
  count,
  active,
  onClick,
}: {
  agent?: string;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`sidebar-compact-row${active ? ' sidebar-compact-row--active' : ''}`}
      aria-pressed={active}
      title={`${label} · ${count} plan${count === 1 ? '' : 's'}`}
    >
      {agent ? (
        <AgentIcon agent={agent} size={12} />
      ) : (
        <span className="rounded-full w-[7px] h-[7px] bg-text shrink-0" />
      )}
      <span className="sidebar-compact-label">{label}</span>
      <span className="sidebar-count-pill">{count}</span>
    </button>
  );
}
