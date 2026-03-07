import {
  AgentIcon,
  buildPlanOutline,
  getAgentLabel,
  MarkdownCodeBlock,
  PlanOutline,
  SkeletonBlock,
} from '@agendex/web';
import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';
import Markdown from 'react-markdown';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';
import { CommentThread } from './CommentThread.tsx';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} minute${mins !== 1 ? 's' : ''} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs !== 1 ? 's' : ''} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

export function SharedPlanView({ token }: { token: string }) {
  const plan = useQuery(api.plans.getPlanByShareToken, { token });

  if (plan === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="w-full max-w-[600px] p-6">
          <SkeletonBlock lines={5} />
        </div>
      </div>
    );
  }

  if (plan === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="text-center">
          <h1 className="text-[18px] font-semibold text-text tracking-[-0.02em] mb-2">
            Plan not found
          </h1>
          <p className="text-[13px] text-tertiary">
            This link may have been revoked or the plan no longer exists.
          </p>
        </div>
      </div>
    );
  }

  const outline = buildPlanOutline({
    title: plan.title,
    content: plan.content,
    filePath: String(plan.filePath ?? ''),
    format: plan.format,
  });
  const { entries, renderContent, renderMode } = outline;

  return (
    <div className="min-h-screen bg-bg text-text">
      <PlanOutline entries={entries} />
      <div className="max-w-[720px] mx-auto px-8 pt-10 pb-20">
        {/* Header */}
        <div className="mb-8 pb-6 border-b border-border">
          <div className="flex items-center gap-1 text-[12px] text-tertiary mb-2.5 font-[450]">
            <span className="flex items-center gap-1.5">
              <AgentIcon agent={plan.agent} size={13} />
              <span>{getAgentLabel(plan.agent)}</span>
            </span>
          </div>

          <h1 className="text-[26px] font-semibold tracking-[-0.03em] leading-[1.25] text-text mb-3">
            {plan.title}
          </h1>

          <div className="flex items-center gap-5 text-[12.5px] text-secondary">
            {plan.createdAt && (
              <span className="flex items-center gap-1.5">
                <ClockIcon />
                {timeAgo(String(plan.createdAt))}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <DocIcon />
              {plan.format.toUpperCase()}
            </span>
            <span className="text-[11px] font-[550] py-0.5 px-[7px] rounded-[5px] bg-[rgba(99,102,241,0.1)] text-[#6366f1]">
              Shared
            </span>
          </div>
        </div>

        {/* Body */}
        {renderMode === 'markdown' ? (
          <article className="plan-markdown">
            <div id="plan-top" aria-hidden="true" />
            <Markdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeSlug]}
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
              {renderContent}
            </Markdown>
          </article>
        ) : (
          <>
            <div id="plan-top" aria-hidden="true" />
            <pre className="plan-plain">{renderContent}</pre>
          </>
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
      className="w-[13px] h-[13px] opacity-40"
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
      className="w-[13px] h-[13px] opacity-40"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
      />
    </svg>
  );
}
