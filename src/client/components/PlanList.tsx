import type { Plan } from '../lib/api.ts';

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

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

export function PlanList({
  plans,
  selectedId,
  onSelect,
}: {
  plans: Plan[];
  selectedId: string | undefined;
  onSelect: (plan: Plan) => void;
}) {
  if (plans.length === 0) {
    return (
      <div className="p-4" style={{ fontSize: '13px', color: 'var(--tertiary)' }}>
        No plans found
      </div>
    );
  }

  return (
    <div>
      {plans.map((plan) => (
        <button
          key={plan.id}
          onClick={() => onSelect(plan)}
          className="w-full text-left block"
          style={{
            padding: '10px 8px',
            borderRadius: '7px',
            background: plan.id === selectedId ? 'var(--active)' : 'transparent',
            cursor: 'pointer',
            border: 'none',
            fontFamily: 'inherit',
          }}
        >
          <div
            style={{
              fontWeight: 500,
              fontSize: '13px',
              lineHeight: '1.35',
              color: 'var(--text)',
              letterSpacing: '-0.01em',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical' as const,
              overflow: 'hidden',
            }}
          >
            {plan.title}
          </div>
          <div
            className="flex items-center gap-1.5"
            style={{ marginTop: '4px', fontSize: '11.5px', color: 'var(--tertiary)' }}
          >
            <span
              className="rounded-full"
              style={{
                width: '5px',
                height: '5px',
                background: AGENT_COLORS[plan.agent] ?? '#6b7280',
                flexShrink: 0,
              }}
            />
            <span>{plan.agent}</span>
            <span>&middot;</span>
            <span>{timeAgo(plan.updatedAt)}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
