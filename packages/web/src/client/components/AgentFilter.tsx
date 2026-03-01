import { getAgentLabel } from '../lib/agent-colors.ts';
import type { AgentStats } from '../lib/api.ts';
import { AgentIcon } from './AgentIcon.tsx';

export function AgentFilter({
  agents,
  selected,
  onSelect,
}: {
  agents: AgentStats[];
  selected: string | undefined;
  onSelect: (agent: string | undefined) => void;
}) {
  const withPlans = agents.filter((a) => a.planCount > 0);

  return (
    <div>
      <div
        style={{
          fontSize: '11px',
          fontWeight: 550,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--tertiary)',
          padding: '0 8px',
          marginBottom: '4px',
        }}
      >
        Agents
      </div>
      <AgentButton
        agent={undefined}
        label="All plans"
        count={agents.reduce((s, a) => s + a.planCount, 0)}
        active={!selected}
        onClick={() => onSelect(undefined)}
      />
      {withPlans.map((a) => (
        <AgentButton
          key={a.agent}
          agent={a.agent}
          label={getAgentLabel(a.agent)}
          count={a.planCount}
          active={a.agent === selected}
          onClick={() => onSelect(a.agent === selected ? undefined : a.agent)}
        />
      ))}
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
      className="flex items-center gap-2 w-full text-left"
      style={{
        padding: '6px 8px',
        borderRadius: '7px',
        border: 'none',
        background: active ? 'var(--active)' : 'transparent',
        fontFamily: 'inherit',
        fontSize: '13px',
        fontWeight: active ? 550 : 450,
        color: 'var(--text)',
        cursor: 'pointer',
      }}
    >
      {agent ? (
        <AgentIcon agent={agent} size={12} />
      ) : (
        <span
          className="rounded-full"
          style={{ width: '7px', height: '7px', background: 'var(--text)', flexShrink: 0 }}
        />
      )}
      <span className="flex-1">{label}</span>
      <span
        style={{
          fontSize: '11.5px',
          color: 'var(--tertiary)',
          fontWeight: 400,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {count}
      </span>
    </button>
  );
}
