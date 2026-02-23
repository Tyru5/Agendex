import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getAgentLabel } from '@agendex/app/src/client/lib/agent-colors.ts';
import {
  looksLikeMarkdown,
  normalizePlanMarkdown,
} from '@agendex/app/src/client/lib/plan-markdown.ts';
import { AgentIcon } from '@agendex/app/src/client/components/AgentIcon.tsx';
import { CommentThread } from './CommentThread.tsx';
import { MarkdownCodeBlock } from '@agendex/app/src/client/components/MarkdownCodeBlock.tsx';
import { SkeletonBlock } from '@agendex/app/src/client/components/Skeleton.tsx';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} minute${mins !== 1 ? 's' : ''} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs !== 1 ? 's' : ''} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

function isMarkdownFormat(format: string, content: string, filePath?: string): boolean {
  if (format.toLowerCase() === 'md') return true;
  if (filePath && /\.mdx?$/i.test(filePath)) return true;
  return looksLikeMarkdown(content);
}

export function SharedPlanView({ token }: { token: string }) {
  const plan = useQuery(api.plans.getPlanByShareToken, { token });

  if (plan === undefined) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: 'var(--bg)' }}
      >
        <div style={{ width: '100%', maxWidth: '600px', padding: '24px' }}>
          <SkeletonBlock lines={5} />
        </div>
      </div>
    );
  }

  if (plan === null) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: 'var(--bg)' }}
      >
        <div style={{ textAlign: 'center' }}>
          <h1
            style={{
              fontSize: '18px',
              fontWeight: 600,
              color: 'var(--text)',
              letterSpacing: '-0.02em',
              marginBottom: '8px',
            }}
          >
            Plan not found
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--tertiary)' }}>
            This link may have been revoked or the plan no longer exists.
          </p>
        </div>
      </div>
    );
  }

  const isMarkdown = isMarkdownFormat(
    plan.format,
    plan.content,
    plan.filePath as string | undefined,
  );
  const markdown = isMarkdown ? normalizePlanMarkdown(plan.content) : '';

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
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
          </div>

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

          <div
            className="flex items-center gap-5"
            style={{ fontSize: '12.5px', color: 'var(--secondary)' }}
          >
            {plan.createdAt && (
              <span className="flex items-center gap-1.5">
                <ClockIcon />
                {timeAgo(plan.createdAt as string)}
              </span>
            )}
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
                background: 'rgba(99,102,241,0.1)',
                color: '#6366f1',
              }}
            >
              Shared
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

                  return (
                    <MarkdownCodeBlock className={className} code={code} language={language} />
                  );
                },
              }}
            >
              {markdown}
            </Markdown>
          </article>
        ) : (
          <pre className="plan-plain">{plan.content}</pre>
        )}

        {/* Comments */}
        <CommentThread planId={plan._id} shareToken={token} />
      </div>
    </div>
  );
}

function ClockIcon() {
  return (
    <svg
      aria-hidden="true"
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
      aria-hidden="true"
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
