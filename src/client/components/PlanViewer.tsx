import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Plan } from "../lib/api.ts";

export function PlanViewer({
  plan,
  onEdit,
}: {
  plan: Plan;
  onEdit: () => void;
}) {
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-zinc-800">
        <div>
          <h1 className="text-lg font-semibold">{plan.title}</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {plan.agent} · {plan.filePath}
          </p>
        </div>
        {plan.format === "md" && (
          <button
            onClick={onEdit}
            className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            Edit
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto px-6 py-4">
        <article className="prose dark:prose-invert prose-sm max-w-none">
          <Markdown remarkPlugins={[remarkGfm]}>{plan.content}</Markdown>
        </article>
      </div>
    </div>
  );
}
