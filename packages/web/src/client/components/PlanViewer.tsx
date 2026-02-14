import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Plan } from '../lib/api.ts';
import { MarkdownCodeBlock } from './MarkdownCodeBlock.tsx';
import { normalizePlanMarkdown } from '../lib/plan-markdown.ts';
import { AgentIcon } from './AgentIcon.tsx';
import { getAgentLabel } from '../lib/agent-colors.ts';
import { SharePlanDialog } from './SharePlanDialog.tsx';
import { useAuth } from '../hooks/useAuth.ts';

function isMarkdownPlan(plan: Plan): boolean {
  if (plan.format.toLowerCase() === 'md') return true;
  return /\.mdx?$/i.test(plan.filePath);
}

function extractWorkspace(plan: Plan): string | undefined {
  return plan.workspace || undefined;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} minute${mins !== 1 ? 's' : ''} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs !== 1 ? 's' : ''} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

export function PlanViewer({ plan, onEdit }: { plan: Plan; onEdit: () => void }) {
  const [showShare, setShowShare] = useState(false);
  const { isAuthenticated } = useAuth();
  const isMarkdown = isMarkdownPlan(plan);
  const markdown = isMarkdown ? normalizePlanMarkdown(plan.content) : '';
  const workspace = extractWorkspace(plan);

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: '40px 32px 80px' }}>
      {/* Header */}
      <div
        style={{
          marginBottom: '32px',
          paddingBottom: '24px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div
          className="flex items-center gap-1"
          style={{
            fontSize: '12px',
            color: 'var(--tertiary)',
            marginBottom: '10px',
            fontWeight: 450,
          }}
        >
          <span className="flex items-center gap-1.5">
            <AgentIcon agent={plan.agent} size={13} />
            <span>{getAgentLabel(plan.agent)}</span>
          </span>
          {workspace && (
            <>
              <span style={{ opacity: 0.5 }}>/</span>
              <span>{workspace}</span>
            </>
          )}
        </div>

        <div className="flex items-start justify-between gap-4">
          <h1
            style={{
              fontSize: '26px',
              fontWeight: 600,
              letterSpacing: '-0.03em',
              lineHeight: 1.25,
              color: 'var(--text)',
              marginBottom: '12px',
            }}
          >
            {plan.title}
          </h1>
          <div className="flex items-center gap-2 shrink-0">
            {isAuthenticated && (
              <button
                onClick={() => setShowShare(true)}
                style={{
                  padding: '5px 12px',
                  fontSize: '12.5px',
                  fontWeight: 500,
                  fontFamily: 'inherit',
                  borderRadius: '7px',
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--secondary)',
                  cursor: 'pointer',
                }}
              >
                Share
              </button>
            )}
            {isMarkdown && (
              <button
                onClick={onEdit}
                style={{
                  padding: '5px 12px',
                  fontSize: '12.5px',
                  fontWeight: 500,
                  fontFamily: 'inherit',
                  borderRadius: '7px',
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--secondary)',
                  cursor: 'pointer',
                }}
              >
                Edit
              </button>
            )}
          </div>
        </div>

        <div
          className="flex items-center gap-5"
          style={{ fontSize: '12.5px', color: 'var(--secondary)' }}
        >
          <span className="flex items-center gap-1.5">
            <ClockIcon />
            Updated {timeAgo(plan.updatedAt)}
          </span>
          <span className="flex items-center gap-1.5">
            <DocIcon />
            {plan.format.toUpperCase()}
          </span>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 550,
              padding: '2px 7px',
              borderRadius: '5px',
              background: 'rgba(34,197,94,0.1)',
              color: '#16a34a',
            }}
          >
            Writable
          </span>
        </div>
      </div>

      {/* Body */}
      {isMarkdown ? (
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

                return <MarkdownCodeBlock className={className} code={code} language={language} />;
              },
            }}
          >
            {markdown}
          </Markdown>
        </article>
      ) : (
        <pre className="plan-plain">{plan.content}</pre>
      )}

      {/* File path footer */}
      <div
        style={{
          marginTop: '40px',
          paddingTop: '16px',
          borderTop: '1px solid var(--border)',
          fontSize: '11.5px',
          color: 'var(--tertiary)',
          fontFamily: "'SF Mono', 'JetBrains Mono', monospace",
          wordBreak: 'break-all',
        }}
      >
        {plan.filePath}
      </div>

      {showShare && <SharePlanDialog plan={plan} onClose={() => setShowShare(false)} />}
    </div>
  );
}

function ClockIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      style={{ width: '13px', height: '13px', opacity: 0.4 }}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
      />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      style={{ width: '13px', height: '13px', opacity: 0.4 }}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
      />
    </svg>
  );
}
