import { useMemo, useState } from 'react';
import { getAgentLabel } from '../lib/agent-colors.ts';
import type { AgentStats } from '../lib/api.ts';
import { AgentIcon } from './AgentIcon.tsx';

const AGENT_SEARCH_THRESHOLD = 6;

export function AgentFilter({
  agents,
  selected,
  onChange,
}: {
  agents: AgentStats[];
  selected: readonly string[];
  onChange: (agents: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const totalPlans = agents.reduce((sum, agent) => sum + agent.planCount, 0);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const sortedAgents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const sorted = agents
      .filter((agent) => agent.planCount > 0)
      .sort((a, b) => {
        if (b.planCount !== a.planCount) return b.planCount - a.planCount;
        return getAgentLabel(a.agent).localeCompare(getAgentLabel(b.agent));
      });
    if (!normalizedQuery) return sorted;
    return sorted.filter(
      (agent) =>
        agent.agent.toLowerCase().includes(normalizedQuery) ||
        getAgentLabel(agent.agent).toLowerCase().includes(normalizedQuery),
    );
  }, [agents, query]);

  function toggleAgent(agent: string) {
    if (selectedSet.has(agent)) {
      onChange(selected.filter((selectedAgent) => selectedAgent !== agent));
      return;
    }
    onChange([...selected, agent]);
  }

  return (
    <div className="sidebar-control-block">
      <div className="sidebar-control-header">
        <span className="sidebar-control-label">Agents</span>
        {selected.length > 0 && <span className="sidebar-count-pill">{selected.length}</span>}
      </div>
      {agents.length >= AGENT_SEARCH_THRESHOLD && (
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="sidebar-inline-input"
          placeholder="Find agent"
          aria-label="Find agent"
        />
      )}
      <div className="sidebar-agent-tray">
        <AgentButton
          agent={undefined}
          label="All plans"
          count={totalPlans}
          active={selected.length === 0}
          onClick={() => onChange([])}
        />
        {sortedAgents.map((agent) => (
          <AgentButton
            key={agent.agent}
            agent={agent.agent}
            label={getAgentLabel(agent.agent)}
            count={agent.planCount}
            active={selectedSet.has(agent.agent)}
            onClick={() => toggleAgent(agent.agent)}
          />
        ))}

        {sortedAgents.length === 0 && <div className="sidebar-muted-note">No agents match</div>}
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
