import { useMemo, useState } from 'react';
import {
  AGENT_IDS,
  getAgentLabel,
  MarkdownCodeBlock,
  type AgentStats,
  type Plan,
} from '@agendex/web';
import { api } from '@convex/_generated/api';
import { useMutation } from 'convex/react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function getAgentOptions(agents: AgentStats[]) {
  return Array.from(new Set([...agents.map((agent) => agent.agent), ...AGENT_IDS]));
}

function makeCloudPlan(id: string, agent: string, title: string, content: string): Plan {
  const now = new Date().toISOString();
  return {
    id,
    agent,
    title,
    content,
    format: 'md',
    filePath: '',
    createdAt: now,
    updatedAt: now,
    metadata: {},
  };
}

export function CloudPlanCreator({
  agents,
  onClose,
  onCreated,
}: {
  agents: AgentStats[];
  onClose: () => void;
  onCreated: (plan: Plan) => void;
}) {
  const publishPlan = useMutation(api.plans.publishPlan);
  const agentOptions = useMemo(() => getAgentOptions(agents), [agents]);
  const [agent, setAgent] = useState(() => agentOptions[0] ?? '');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();

  async function handleCreate() {
    if (!agent || !title.trim() || !content.trim()) return;
    setCreating(true);
    setError(undefined);

    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();

    try {
      const planId = await publishPlan({
        localPlanId: `cloud-${crypto.randomUUID()}`,
        agent,
        title: trimmedTitle,
        content: trimmedContent,
        format: 'md',
      });
      onCreated(makeCloudPlan(planId, agent, trimmedTitle, trimmedContent));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'create failed');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-3 gap-4 border-b border-border">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <select
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            className="py-[5px] px-2 text-[12.5px] font-medium font-[inherit] rounded-[7px] border border-border bg-surface text-text cursor-pointer"
          >
            {agentOptions.map((agentId) => (
              <option key={agentId} value={agentId}>
                {getAgentLabel(agentId)}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Plan title..."
            className="flex-1 py-[5px] px-2.5 text-[14px] font-semibold font-[inherit] rounded-[7px] border border-border bg-transparent text-text outline-none"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {error && <span className="text-[12px] text-[#ef4444]">{error}</span>}
          <button
            type="button"
            onClick={onClose}
            className="py-[5px] px-3 text-[12.5px] font-medium font-[inherit] rounded-[7px] border border-border bg-transparent text-secondary cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating || !agent || !title.trim() || !content.trim()}
            className="py-[5px] px-3 text-[12.5px] font-medium font-[inherit] rounded-[7px] border-none bg-text text-bg"
            style={{
              cursor: creating ? 'default' : 'pointer',
              opacity: creating || !agent || !title.trim() || !content.trim() ? 0.5 : 1,
            }}
          >
            {creating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden min-h-0">
        <div className="flex-1 min-w-0 border-r border-border p-4">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write your plan in Markdown..."
            className="h-full w-full resize-none rounded-[10px] border border-border bg-surface px-4 py-3 text-[13px] leading-6 text-text outline-none"
          />
        </div>
        <div className="flex-1 min-w-0 overflow-auto py-6 px-8">
          {content ? (
            <article className="plan-markdown">
              <Markdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code({ className, children, node: _node, ...props }) {
                    const code = String(children).replace(/\n$/, '');
                    const language = /(?:lang|language)-([^\s]+)/.exec(className ?? '')?.[1];
                    const isBlock = Boolean(language) || code.includes('\n');

                    if (!isBlock) {
                      return (
                        <code className={className} {...props}>
                          {children}
                        </code>
                      );
                    }

                    return (
                      <MarkdownCodeBlock className={className} code={code} language={language} />
                    );
                  },
                }}
              >
                {`# ${title || 'Untitled'}\n\n${content}`}
              </Markdown>
            </article>
          ) : (
            <div className="h-full flex items-center justify-center text-[13px] text-tertiary">
              Start typing to see preview
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
