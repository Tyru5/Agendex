import type { AgentStats } from '../lib/api.ts';

const AGENT_COLORS: Record<string, string> = {
  'claude-code': 'bg-orange-500',
  'codex-cli': 'bg-green-500',
  'continue-ide': 'bg-purple-500',
  cursor: 'bg-blue-500',
  amp: 'bg-pink-500',
  cline: 'bg-cyan-500',
  'copilot-chat': 'bg-gray-500',
  droid: 'bg-red-500',
  'kilo-cli': 'bg-yellow-500',
  windsurf: 'bg-teal-500',
  aider: 'bg-indigo-500',
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
    <div className="space-y-1">
      <button
        onClick={() => onSelect(undefined)}
        className={`w-full text-left px-3 py-1.5 rounded text-sm ${
          !selected
            ? 'bg-blue-100 dark:bg-blue-900/40 font-medium'
            : 'hover:bg-gray-100 dark:hover:bg-zinc-800'
        }`}
      >
        All agents
      </button>
      {withPlans.map((a) => (
        <button
          key={a.agent}
          onClick={() => onSelect(a.agent === selected ? undefined : a.agent)}
          className={`w-full text-left px-3 py-1.5 rounded text-sm flex items-center gap-2 ${
            a.agent === selected
              ? 'bg-blue-100 dark:bg-blue-900/40 font-medium'
              : 'hover:bg-gray-100 dark:hover:bg-zinc-800'
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${AGENT_COLORS[a.agent] ?? 'bg-gray-400'}`} />
          <span className="flex-1">{a.agent}</span>
          <span className="text-xs text-gray-500">{a.planCount}</span>
        </button>
      ))}
    </div>
  );
}
