import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';
import { getAgentLabel } from '../lib/agent-colors.ts';
import type { Plan } from '../lib/api.ts';
import { buildPlanOutline } from '../lib/extract-headings.ts';
import { sanitizeSchema } from '../lib/sanitize-schema.ts';
import { AgentIcon } from './AgentIcon.tsx';
import { MarkdownCodeBlock } from './MarkdownCodeBlock.tsx';
import { PlanOutline } from './PlanOutline.tsx';
import { TechDependencyChart } from './TechDependencyChart.tsx';

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

type PlanViewerProps = {
  plan: Plan;
  headerExtra?: ReactNode;
  onEdit?: () => void;
  onHistory?: () => void;
  onShare?: () => void;
  onChartWideChange?: (wide: boolean) => void;
  mode?: 'single' | 'split';
};

export function PlanViewer({
  plan,
  headerExtra,
  onEdit,
  onHistory,
  onShare,
  onChartWideChange,
  mode = 'single',
}: PlanViewerProps) {
  const [copied, setCopied] = useState(false);
  const isSplit = mode === 'split';

  const handleCopy = async () => {
    await navigator.clipboard.writeText(plan.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const workspace = extractWorkspace(plan);

  const outline = useMemo(
    () =>
      buildPlanOutline({
        title: plan.title,
        content: plan.content,
        filePath: plan.filePath,
        format: plan.format,
      }),
    [plan.content, plan.filePath, plan.format, plan.title],
  );
  const { entries, renderContent, renderMode } = outline;

  const showOutline = entries.filter((e) => e.source !== 'fallback_root').length >= 2;

  return (
    <>
      {showOutline && !isSplit && <PlanOutline entries={entries} />}
      <div
        className={
          isSplit ? 'mx-auto px-6 pt-8 pb-[72px]' : 'max-w-[720px] mx-auto px-8 pt-10 pb-20'
        }
      >
        {/* Header */}
        <div className="mb-8 pb-6 border-b border-border">
          <div
            className="flex items-center gap-1 text-xs text-tertiary mb-2.5"
            style={{ fontWeight: 450 }}
          >
            <span className="flex items-center gap-1.5">
              <AgentIcon agent={plan.agent} size={13} />
              <span>{getAgentLabel(plan.agent)}</span>
            </span>
            {workspace && (
              <>
                <span className="opacity-50">/</span>
                <span>{workspace}</span>
                <CopyPathButton path={plan.filePath} />
              </>
            )}
          </div>

          <h1 className="text-[26px] font-semibold tracking-[-0.03em] leading-[1.25] text-text mb-3">
            {plan.title}
          </h1>

          <div className="flex items-center gap-5 text-[12.5px] text-secondary mb-4">
            <span className="flex items-center gap-1.5">
              <ClockIcon />
              Updated {timeAgo(plan.updatedAt)}
            </span>
            <span className="flex items-center gap-1.5">
              <DocIcon />
              {plan.format.toUpperCase()}
            </span>
            <span
              className="text-[11px] px-[7px] py-[2px] rounded-[5px] bg-[rgba(100,116,139,0.1)] text-[#64748b]"
              style={{ fontWeight: 550 }}
            >
              Read-only
            </span>
          </div>

          {headerExtra}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              title={copied ? 'Copied!' : 'Copy plan'}
              className="flex items-center gap-[5px] px-3 py-[5px] text-[12.5px] font-medium font-inherit rounded-[7px] border border-border bg-transparent cursor-pointer transition-colors duration-200"
              style={{ color: copied ? '#16a34a' : 'var(--secondary)' }}
            >
              <span className="relative flex items-center justify-center w-[13px] h-[13px]">
                <span
                  className="absolute flex transition-[opacity,transform] duration-200 ease-in-out"
                  style={{
                    opacity: copied ? 0 : 1,
                    transform: copied ? 'scale(0.5)' : 'scale(1)',
                  }}
                >
                  <CopyIcon />
                </span>
                <span
                  className="absolute flex transition-[opacity,transform] duration-200 ease-in-out"
                  style={{
                    opacity: copied ? 1 : 0,
                    transform: copied ? 'scale(1)' : 'scale(0.5)',
                  }}
                >
                  <CheckIcon />
                </span>
              </span>
              {copied ? 'Copied' : 'Copy'}
            </button>
            {onEdit && (
              <button
                type="button"
                onClick={onEdit}
                title="Edit plan"
                className="flex items-center gap-[5px] px-3 py-[5px] text-[12.5px] font-medium font-inherit rounded-[7px] border border-border bg-transparent text-secondary cursor-pointer"
              >
                <EditIcon />
                Edit
              </button>
            )}
            {onShare && (
              <button
                type="button"
                onClick={onShare}
                title="Share plan"
                className="flex items-center gap-[5px] px-3 py-[5px] text-[12.5px] font-medium font-inherit rounded-[7px] border border-border bg-transparent text-secondary cursor-pointer"
              >
                <ShareIcon />
                Share
              </button>
            )}
            {onHistory && (
              <button
                type="button"
                onClick={onHistory}
                title="Version history"
                className="flex items-center gap-[5px] px-3 py-[5px] text-[12.5px] font-medium font-inherit rounded-[7px] border border-border bg-transparent text-secondary cursor-pointer"
              >
                <HistoryIcon />
                History
              </button>
            )}
          </div>
        </div>

        {onChartWideChange && (
          <div style={{ marginTop: '8px', marginBottom: '24px' }}>
            <TechDependencyChart plan={plan} onWideChange={onChartWideChange} />
          </div>
        )}

        {/* Body */}
        {renderMode === 'markdown' ? (
          <article className="plan-markdown">
            <div id="plan-top" aria-hidden="true" />
            <Markdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema], rehypeSlug]}
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

        {/* File path footer */}
        <div
          className="flex items-center justify-between gap-2 mt-10 pt-4 border-t border-border text-[11.5px] text-tertiary"
          style={{ fontFamily: "'SF Mono', 'JetBrains Mono', monospace" }}
        >
          <span className="break-all">{plan.filePath}</span>
          <CopyPathButton path={plan.filePath} />
        </div>

        {!isSplit && <ScrollToTop />}
      </div>
    </>
  );
}

function CopyPathButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(path);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? 'Copied!' : 'Copy path'}
      className="relative p-[2px] rounded-[4px] border-none bg-transparent cursor-pointer flex items-center justify-center shrink-0 w-[17px] h-[17px] transition-opacity duration-150"
      style={{ opacity: copied ? 1 : 0.5 }}
      onMouseEnter={(e) => {
        e.currentTarget.style.opacity = '1';
      }}
      onMouseLeave={(e) => {
        if (!copied) e.currentTarget.style.opacity = '0.5';
      }}
    >
      <span
        className="absolute flex text-tertiary transition-[opacity,transform] duration-200 ease-in-out"
        style={{
          opacity: copied ? 0 : 1,
          transform: copied ? 'scale(0.5)' : 'scale(1)',
        }}
      >
        <CopyIcon />
      </span>
      <span
        className="absolute flex text-[#16a34a] transition-[opacity,transform] duration-200 ease-in-out"
        style={{
          opacity: copied ? 1 : 0,
          transform: copied ? 'scale(1)' : 'scale(0.5)',
        }}
      >
        <CheckIcon />
      </span>
    </button>
  );
}

function ScrollToTop() {
  const [visible, setVisible] = useState(false);
  const containerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const wrapper = document.querySelector('.main-scroll') as HTMLElement | null;
    if (!wrapper) return;
    containerRef.current = wrapper;

    const onScroll = () => setVisible(wrapper.scrollTop > 400);
    wrapper.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => wrapper.removeEventListener('scroll', onScroll);
  }, []);

  const scrollToTop = () => {
    containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <button
      type="button"
      onClick={scrollToTop}
      aria-label="Scroll to top"
      className="scroll-to-top fixed bottom-7 right-7 w-[38px] h-[38px] rounded-[10px] border border-border bg-surface text-secondary cursor-pointer flex items-center justify-center shadow-[0_2px_12px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.02)] z-50 transition-[opacity,transform,border-color,background] duration-200"
      data-visible={visible}
      style={{
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
        transform: visible ? 'translateY(0)' : 'translateY(8px)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--tertiary)';
        e.currentTarget.style.color = 'var(--text)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border)';
        e.currentTarget.style.color = 'var(--secondary)';
      }}
    >
      <svg
        aria-hidden="true"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2}
        stroke="currentColor"
        className="w-[15px] h-[15px]"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
      </svg>
    </button>
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

function CopyIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className="w-[13px] h-[13px]"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.334a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className="w-[13px] h-[13px]"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className="w-[13px] h-[13px]"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z"
      />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className="w-[13px] h-[13px]"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m16.862 4.487 1.687-1.688a2.25 2.25 0 1 1 3.182 3.182L10.582 17.13a4.5 4.5 0 0 1-1.897 1.13L6 19l.74-2.685a4.5 4.5 0 0 1 1.13-1.897L16.862 4.487Z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
      />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className="w-[13px] h-[13px]"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v5h5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l4 2" />
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
