import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';
import { getAgentLabel } from '../lib/agent-colors.ts';
import type { Plan } from '../lib/api.ts';
import { buildPlanOutline } from '../lib/extract-headings.ts';
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

export function PlanViewer({
  plan,
  headerExtra,
  onEdit,
  onHistory,
  onShare,
  onChartWideChange,
}: {
  plan: Plan;
  headerExtra?: ReactNode;
  onEdit?: () => void;
  onHistory?: () => void;
  onShare?: () => void;
  onChartWideChange?: (wide: boolean) => void;
  [key: string]: unknown;
}) {
  const [copied, setCopied] = useState(false);

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

  const showOutline = entries.some((e) => e.source !== 'fallback_root');

  return (
    <>
      {showOutline && <PlanOutline entries={entries} />}
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
                <CopyPathButton path={plan.filePath} />
              </>
            )}
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
            style={{ fontSize: '12.5px', color: 'var(--secondary)', marginBottom: '16px' }}
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
                background: 'rgba(100,116,139,0.1)',
                color: '#64748b',
              }}
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
              style={{
                padding: '5px 12px',
                fontSize: '12.5px',
                fontWeight: 500,
                fontFamily: 'inherit',
                borderRadius: '7px',
                border: '1px solid var(--border)',
                background: 'transparent',
                color: copied ? '#16a34a' : 'var(--secondary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                transition: 'color 0.2s ease',
              }}
            >
              <span
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '13px',
                  height: '13px',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    display: 'flex',
                    opacity: copied ? 0 : 1,
                    transform: copied ? 'scale(0.5)' : 'scale(1)',
                    transition: 'opacity 0.2s ease, transform 0.2s ease',
                  }}
                >
                  <CopyIcon />
                </span>
                <span
                  style={{
                    position: 'absolute',
                    display: 'flex',
                    opacity: copied ? 1 : 0,
                    transform: copied ? 'scale(1)' : 'scale(0.5)',
                    transition: 'opacity 0.2s ease, transform 0.2s ease',
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
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
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
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
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
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
              >
                <HistoryIcon />
                History
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        {renderMode === 'markdown' ? (
          <article className="plan-markdown">
            <div id="plan-top" aria-hidden="true" />
            <Markdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw, rehypeSlug]}
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

        {onChartWideChange && (
          <div style={{ marginTop: '40px' }}>
            <TechDependencyChart plan={plan} onWideChange={onChartWideChange} />
          </div>
        )}

        {/* File path footer */}
        <div
          className="flex items-center justify-between gap-2"
          style={{
            marginTop: '40px',
            paddingTop: '16px',
            borderTop: '1px solid var(--border)',
            fontSize: '11.5px',
            color: 'var(--tertiary)',
            fontFamily: "'SF Mono', 'JetBrains Mono', monospace",
          }}
        >
          <span style={{ wordBreak: 'break-all' }}>{plan.filePath}</span>
          <CopyPathButton path={plan.filePath} />
        </div>

        <ScrollToTop />
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
      style={{
        position: 'relative',
        padding: '2px',
        borderRadius: '4px',
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        width: '17px',
        height: '17px',
        opacity: copied ? 1 : 0.5,
        transition: 'opacity 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.opacity = '1';
      }}
      onMouseLeave={(e) => {
        if (!copied) e.currentTarget.style.opacity = '0.5';
      }}
    >
      <span
        style={{
          position: 'absolute',
          display: 'flex',
          color: 'var(--tertiary)',
          opacity: copied ? 0 : 1,
          transform: copied ? 'scale(0.5)' : 'scale(1)',
          transition: 'opacity 0.2s ease, transform 0.2s ease',
        }}
      >
        <CopyIcon />
      </span>
      <span
        style={{
          position: 'absolute',
          display: 'flex',
          color: '#16a34a',
          opacity: copied ? 1 : 0,
          transform: copied ? 'scale(1)' : 'scale(0.5)',
          transition: 'opacity 0.2s ease, transform 0.2s ease',
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
      className="scroll-to-top"
      data-visible={visible}
      style={{
        position: 'fixed',
        bottom: '28px',
        right: '28px',
        width: '38px',
        height: '38px',
        borderRadius: '10px',
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        color: 'var(--secondary)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 2px 12px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.02)',
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
        transform: visible ? 'translateY(0)' : 'translateY(8px)',
        transition: 'opacity 0.2s ease, transform 0.2s ease, border-color 0.15s, background 0.15s',
        zIndex: 50,
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
        style={{ width: '15px', height: '15px' }}
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

function CopyIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      style={{ width: '13px', height: '13px' }}
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
      style={{ width: '13px', height: '13px' }}
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
      style={{ width: '13px', height: '13px' }}
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
      style={{ width: '13px', height: '13px' }}
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
      style={{ width: '13px', height: '13px' }}
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
