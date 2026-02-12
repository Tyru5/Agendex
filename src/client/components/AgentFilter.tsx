import type { AgentStats } from '../lib/api.ts';

const AGENT_COLORS: Record<string, string> = {
  'claude-code': '#8b5cf6',
  'codex-cli': '#f97316',
  'continue-ide': '#3b82f6',
  cursor: '#22c55e',
  amp: '#ec4899',
  cline: '#06b6d4',
  'copilot-chat': '#6b7280',
  droid: '#ef4444',
  'kilo-cli': '#eab308',
  windsurf: '#14b8a6',
  aider: '#6366f1',
};

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
        label="All plans"
        dotColor="var(--text)"
        count={agents.reduce((s, a) => s + a.planCount, 0)}
        active={!selected}
        onClick={() => onSelect(undefined)}
      />
      {withPlans.map((a) => (
        <AgentButton
          key={a.agent}
          label={a.agent}
          dotColor={AGENT_COLORS[a.agent] ?? '#6b7280'}
          count={a.planCount}
          active={a.agent === selected}
          onClick={() => onSelect(a.agent === selected ? undefined : a.agent)}
        />
      ))}
    </div>
  );
}

function AgentButton({
  label,
  dotColor,
  count,
  active,
  onClick,
}: {
  label: string;
  dotColor: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
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
      <span
        className="rounded-full"
        style={{ width: '7px', height: '7px', background: dotColor, flexShrink: 0 }}
      />
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
