import type { Plan } from "../lib/api.ts";

const AGENT_COLORS: Record<string, string> = {
  "claude-code": "bg-orange-500",
  "codex-cli": "bg-green-500",
  "continue-ide": "bg-purple-500",
  cursor: "bg-blue-500",
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
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
    return <div className="p-4 text-sm text-gray-500">No plans found</div>;
  }

  return (
    <div className="space-y-0.5">
      {plans.map((plan) => (
        <button
          key={plan.id}
          onClick={() => onSelect(plan)}
          className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${
            plan.id === selectedId
              ? "bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800"
              : "hover:bg-gray-50 dark:hover:bg-zinc-800/50 border border-transparent"
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className={`w-2 h-2 rounded-full shrink-0 ${AGENT_COLORS[plan.agent] ?? "bg-gray-400"}`} />
            <span className="font-medium truncate">{plan.title}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>{plan.agent}</span>
            <span>·</span>
            <span>{timeAgo(plan.updatedAt)}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
