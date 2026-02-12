import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Plan } from '../lib/api.ts';
import { normalizePlanMarkdown } from '../lib/plan-markdown.ts';

function isMarkdownPlan(plan: Plan): boolean {
  if (plan.format.toLowerCase() === 'md') return true;
  return /\.mdx?$/i.test(plan.filePath);
}

export function PlanViewer({ plan, onEdit }: { plan: Plan; onEdit: () => void }) {
  const isMarkdown = isMarkdownPlan(plan);
  const markdown = isMarkdown ? normalizePlanMarkdown(plan.content) : '';

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-gray-200 dark:border-zinc-800">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold leading-tight text-balance">{plan.title}</h1>
            <p className="text-xs text-gray-500 mt-1 break-all">{plan.filePath}</p>
            <div className="mt-2 flex items-center gap-2 text-xs">
              <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 dark:bg-zinc-800 dark:text-zinc-200">
                {plan.agent}
              </span>
              <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                {plan.format.toUpperCase()}
              </span>
            </div>
          </div>
          {isMarkdown && (
            <button
              onClick={onEdit}
              className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors shrink-0"
            >
              Edit
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-auto px-6 py-6">
        <div className="plan-surface">
          <div className="plan-content">
            {isMarkdown ? (
              <article className="plan-markdown">
                <Markdown remarkPlugins={[remarkGfm]}>{markdown}</Markdown>
              </article>
            ) : (
              <pre className="plan-plain">{plan.content}</pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
