import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';
import { useFullscreen } from '../hooks/useFullscreen.ts';
import { usePlanAnnotationHighlights } from '../hooks/usePlanAnnotationHighlights.ts';
import { getAgentLabel } from '../lib/agent-colors.ts';
import {
  createPlanTextAnchor,
  type PlanAnnotationKind,
  type PlanAnnotationRecord,
  type PlanTextAnchor,
} from '../lib/annotations.ts';
import type { Plan } from '../lib/api.ts';
import { buildPlanOutline } from '../lib/extract-headings.ts';
import { sanitizeSchema } from '../lib/sanitize-schema.ts';
import { extractSyncOrigin, formatSyncOriginLabel } from '../lib/sync-origin.ts';
import { AgentIcon } from './AgentIcon.tsx';
import { ExitFullscreenIcon, FullscreenIcon } from './FullscreenIcons.tsx';
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

export type PlanAnnotationCreateDraft = {
  type: PlanAnnotationKind;
  anchor: PlanTextAnchor;
  selectedText: string;
  body?: string;
  replacementText?: string;
};

export type PlanAnnotationCreateResult = void | false;

type SelectionToolbarState = {
  selectedText: string;
  anchor: PlanTextAnchor;
  top: number;
  left: number;
};

type AnnotationComposerState = {
  type: PlanAnnotationKind;
  body: string;
  replacementText: string;
};

const ANNOTATION_SELECTION_BLOCKED_TAGS = 'code, pre, script, style, textarea, input, mark';

function requiresReplacementText(type: PlanAnnotationKind): boolean {
  return type === 'replacement' || type === 'insertion';
}

function requiresBody(type: PlanAnnotationKind): boolean {
  return type === 'comment' || type === 'global_comment';
}

function replacementTextLabel(type: PlanAnnotationKind): string {
  return type === 'insertion' ? 'Inserted text' : 'Suggested replacement text';
}

function bodyLabel(type: PlanAnnotationKind): string {
  if (type === 'replacement' || type === 'insertion') return 'Optional note for the agent';
  if (type === 'deletion') return 'Optional reason for deletion';
  return 'Feedback for the agent';
}

function countOccurrences(value: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let searchFrom = 0;
  while (searchFrom < value.length) {
    const index = value.indexOf(needle, searchFrom);
    if (index < 0) break;
    count++;
    searchFrom = index + needle.length;
  }
  return count;
}

function occurrenceIndexForSelection(
  root: HTMLElement,
  range: Range,
  selectedText: string,
): number {
  const beforeRange = document.createRange();
  beforeRange.selectNodeContents(root);
  beforeRange.setEnd(range.startContainer, range.startOffset);
  return countOccurrences(beforeRange.toString(), selectedText);
}

function intersectsNestedBlockedSelection(root: HTMLElement, range: Range): boolean {
  for (const element of Array.from(root.querySelectorAll(ANNOTATION_SELECTION_BLOCKED_TAGS))) {
    if (element === root) continue;
    if (range.intersectsNode(element)) return true;
  }
  return false;
}

type PlanViewerProps = {
  plan: Plan;
  headerExtra?: ReactNode;
  onEdit?: () => void;
  onHistory?: () => void;
  onShare?: () => void;
  onChartWideChange?: (wide: boolean) => void;
  onToggleChart?: () => void;
  mode?: 'single' | 'split';
  outlineHidden?: boolean;
  chartHidden?: boolean;
  annotations?: PlanAnnotationRecord[];
  selectedAnnotationId?: string | null;
  canCreateAnnotations?: boolean;
  annotationUpgradeMessage?: string;
  annotationCreateError?: string;
  onCreateAnnotation?: (
    draft: PlanAnnotationCreateDraft,
  ) => PlanAnnotationCreateResult | Promise<PlanAnnotationCreateResult>;
  onClearAnnotationCreateError?: () => void;
  onSelectAnnotation?: (id: string | null) => void;
};

export function PlanViewer({
  plan,
  headerExtra,
  onEdit,
  onHistory,
  onShare,
  onChartWideChange,
  onToggleChart,
  mode = 'single',
  outlineHidden,
  chartHidden,
  annotations = [],
  selectedAnnotationId,
  canCreateAnnotations = false,
  annotationUpgradeMessage,
  annotationCreateError,
  onCreateAnnotation,
  onClearAnnotationCreateError,
  onSelectAnnotation,
}: PlanViewerProps) {
  const [copied, setCopied] = useState(false);
  const [selectionToolbar, setSelectionToolbar] = useState<SelectionToolbarState | null>(null);
  const [annotationComposer, setAnnotationComposer] = useState<AnnotationComposerState | null>(
    null,
  );
  const [annotationComposerError, setAnnotationComposerError] = useState<string | undefined>();
  const bodyRef = useRef<HTMLElement | null>(null);
  const annotationOverlayRef = useRef<HTMLElement | null>(null);
  const annotationComposerFirstFieldRef = useRef<HTMLTextAreaElement | null>(null);
  const fullscreen = useFullscreen<HTMLDivElement>();
  const isSplit = mode === 'split';

  const handleCopy = async () => {
    await navigator.clipboard.writeText(plan.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const workspace = extractWorkspace(plan);
  const syncOrigin = extractSyncOrigin(plan);

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

  usePlanAnnotationHighlights({
    rootRef: bodyRef,
    annotations,
    selectedAnnotationId,
    onSelectAnnotation,
    contentKey: renderContent,
  });

  const annotationComposerType = annotationComposer?.type;

  useEffect(() => {
    if (!annotationComposerType) return;
    annotationComposerFirstFieldRef.current?.focus();
  }, [annotationComposerType]);

  useEffect(() => {
    if (!selectionToolbar) return;

    function handleDocumentPointerDown(event: PointerEvent) {
      if (!(event.target instanceof Node)) return;

      const body = bodyRef.current;
      const overlay = annotationOverlayRef.current;
      if (body?.contains(event.target) || overlay?.contains(event.target)) return;

      setAnnotationComposer(null);
      setSelectionToolbar(null);
    }

    document.addEventListener('pointerdown', handleDocumentPointerDown);
    return () => document.removeEventListener('pointerdown', handleDocumentPointerDown);
  }, [selectionToolbar]);

  const showAnnotationUpgrade = Boolean(annotationUpgradeMessage && !canCreateAnnotations);

  function updateSelectionToolbar() {
    if (!canCreateAnnotations || !onCreateAnnotation) return;

    window.setTimeout(() => {
      const root = bodyRef.current;
      const selection = window.getSelection();
      if (!root || !selection || selection.isCollapsed || selection.rangeCount === 0) {
        setSelectionToolbar(null);
        setAnnotationComposer(null);
        return;
      }

      const range = selection.getRangeAt(0);
      if (
        !root.contains(range.commonAncestorContainer) ||
        intersectsNestedBlockedSelection(root, range)
      ) {
        setSelectionToolbar(null);
        setAnnotationComposer(null);
        return;
      }

      const selectedText = selection.toString().trim();
      if (selectedText.length < 2) {
        setSelectionToolbar(null);
        setAnnotationComposer(null);
        return;
      }

      const rect = range.getBoundingClientRect();
      const occurrenceIndex = occurrenceIndexForSelection(root, range, selectedText);
      setSelectionToolbar({
        selectedText,
        anchor: createPlanTextAnchor(renderContent, selectedText, { occurrenceIndex }),
        top: Math.max(8, rect.top - 48),
        left: rect.left + rect.width / 2,
      });
      setAnnotationComposer(null);
    }, 0);
  }

  function beginAnnotationFromSelection(type: PlanAnnotationKind) {
    if (!selectionToolbar || !onCreateAnnotation) return;
    onClearAnnotationCreateError?.();
    setAnnotationComposerError(undefined);
    setAnnotationComposer({ type, body: '', replacementText: '' });
  }

  function dismissAnnotationComposer() {
    onClearAnnotationCreateError?.();
    setAnnotationComposerError(undefined);
    window.getSelection()?.removeAllRanges();
    setAnnotationComposer(null);
    setSelectionToolbar(null);
  }

  async function submitAnnotationComposer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectionToolbar || !annotationComposer || !onCreateAnnotation) return;

    const body = annotationComposer.body.trim() || undefined;
    const replacementText = annotationComposer.replacementText.trim() || undefined;
    if (requiresReplacementText(annotationComposer.type) && !replacementText) return;
    if (requiresBody(annotationComposer.type) && !body) return;

    onClearAnnotationCreateError?.();
    setAnnotationComposerError(undefined);

    try {
      const result = await onCreateAnnotation({
        type: annotationComposer.type,
        selectedText: selectionToolbar.selectedText,
        anchor: selectionToolbar.anchor,
        body,
        replacementText,
      });
      if (result === false) return;
    } catch (err) {
      setAnnotationComposerError(
        err instanceof Error ? err.message : 'Failed to create annotation',
      );
      return;
    }

    window.getSelection()?.removeAllRanges();
    setAnnotationComposer(null);
    setSelectionToolbar(null);
  }

  const canSubmitAnnotationComposer = annotationComposer
    ? (!requiresReplacementText(annotationComposer.type) ||
        annotationComposer.replacementText.trim().length > 0) &&
      (!requiresBody(annotationComposer.type) || annotationComposer.body.trim().length > 0)
    : false;
  const composerError = annotationCreateError ?? annotationComposerError;

  return (
    <div
      ref={fullscreen.ref}
      style={
        fullscreen.isFullscreen
          ? { background: 'var(--bg)', overflow: 'auto', height: '100%' }
          : undefined
      }
      className={fullscreen.isFullscreen ? 'main-scroll' : undefined}
    >
      {showOutline && !isSplit && <PlanOutline entries={entries} pinned={!outlineHidden} />}
      <div
        className={
          isSplit ? 'mx-auto px-6 pt-8 pb-[72px]' : 'max-w-[720px] mx-auto px-8 pt-10 pb-20'
        }
      >
        {/* Header */}
        <header className="plan-header">
          <div className="plan-header-breadcrumb">
            <span className="plan-header-breadcrumb-item">
              <AgentIcon agent={plan.agent} size={13} />
              <span>{getAgentLabel(plan.agent)}</span>
            </span>
            {workspace && (
              <>
                <span className="plan-header-breadcrumb-separator">/</span>
                <span className="plan-header-breadcrumb-workspace">{workspace}</span>
                <CopyPathButton path={plan.filePath} />
              </>
            )}
          </div>

          <h1 className="plan-header-title" title={plan.title}>
            {plan.title}
          </h1>

          <div className="plan-header-meta" aria-label="Plan details">
            <span className="plan-header-meta-item">
              <ClockIcon />
              Updated {timeAgo(plan.updatedAt)}
            </span>
            <span className="plan-header-meta-item">
              <DocIcon />
              {plan.format.toUpperCase()}
            </span>
            <span className="plan-readonly-badge">Read-only</span>
            {syncOrigin && (
              <span
                className="plan-header-meta-item plan-header-meta-item--sync"
                title={
                  [
                    syncOrigin.hostname ? `Host: ${syncOrigin.hostname}` : null,
                    syncOrigin.deviceId ? `Device ID: ${syncOrigin.deviceId}` : null,
                    syncOrigin.ipAddress ? `IP: ${syncOrigin.ipAddress}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'Synced from this machine'
                }
              >
                <MachineIcon />
                <span className="plan-header-meta-label">
                  Synced from <strong>{formatSyncOriginLabel(syncOrigin)}</strong>
                </span>
              </span>
            )}
          </div>

          <div className="plan-header-utility-row">
            {headerExtra && <div className="plan-header-extra">{headerExtra}</div>}
            <div className="plan-action-toolbar" aria-label="Plan actions">
              <button
                type="button"
                onClick={handleCopy}
                title={copied ? 'Copied!' : 'Copy plan'}
                aria-label={copied ? 'Plan copied' : 'Copy plan'}
                className="plan-action-button"
                style={{ color: copied ? 'var(--success)' : 'var(--secondary)' }}
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
              </button>
              {onEdit && (
                <button
                  type="button"
                  onClick={onEdit}
                  title="Edit plan"
                  aria-label="Edit plan"
                  className="plan-action-button"
                >
                  <EditIcon />
                </button>
              )}
              {onShare && (
                <button
                  type="button"
                  onClick={onShare}
                  title="Share plan"
                  aria-label="Share plan"
                  className="plan-action-button"
                >
                  <ShareIcon />
                </button>
              )}
              {onHistory && (
                <button
                  type="button"
                  onClick={onHistory}
                  title="Version history"
                  aria-label="Version history"
                  className="plan-action-button"
                >
                  <HistoryIcon />
                </button>
              )}
              {onToggleChart && (
                <button
                  type="button"
                  onClick={onToggleChart}
                  title={chartHidden ? 'Show tech chart (⇧⌘G)' : 'Hide tech chart (⇧⌘G)'}
                  aria-label={chartHidden ? 'Show tech chart' : 'Hide tech chart'}
                  aria-pressed={!chartHidden}
                  className="plan-action-button"
                >
                  <ChartIcon />
                </button>
              )}
              <button
                type="button"
                onClick={() => fullscreen.toggle()}
                title={fullscreen.isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
                aria-label={fullscreen.isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                className="plan-action-button"
              >
                {fullscreen.isFullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
              </button>
            </div>
          </div>
        </header>

        {onChartWideChange && !chartHidden && (
          <div style={{ marginTop: '8px', marginBottom: '24px' }}>
            <TechDependencyChart plan={plan} onWideChange={onChartWideChange} />
          </div>
        )}

        {showAnnotationUpgrade && (
          <div className="plan-annotation-upgrade" role="note">
            {annotationUpgradeMessage}
          </div>
        )}

        {selectionToolbar && !annotationComposer && (
          <div
            ref={(node) => {
              annotationOverlayRef.current = node;
            }}
            className="plan-annotation-toolbar"
            role="toolbar"
            aria-label="Create plan annotation"
            style={{ top: selectionToolbar.top, left: selectionToolbar.left }}
          >
            <button type="button" onClick={() => beginAnnotationFromSelection('comment')}>
              Comment
            </button>
            <button type="button" onClick={() => beginAnnotationFromSelection('replacement')}>
              Replace
            </button>
            <button type="button" onClick={() => beginAnnotationFromSelection('deletion')}>
              Delete
            </button>
          </div>
        )}

        {selectionToolbar && annotationComposer && (
          <form
            ref={(node) => {
              annotationOverlayRef.current = node;
            }}
            className="plan-annotation-composer"
            aria-label="Create plan annotation"
            style={{ top: selectionToolbar.top, left: selectionToolbar.left }}
            onSubmit={(event) => void submitAnnotationComposer(event)}
          >
            {(annotationComposer.type === 'replacement' ||
              annotationComposer.type === 'insertion') && (
              <label className="plan-annotation-composer-field">
                <span>{replacementTextLabel(annotationComposer.type)}</span>
                <textarea
                  value={annotationComposer.replacementText}
                  ref={
                    requiresReplacementText(annotationComposer.type)
                      ? annotationComposerFirstFieldRef
                      : undefined
                  }
                  onChange={(event) => {
                    const { value } = event.currentTarget;
                    setAnnotationComposer((current) =>
                      current ? { ...current, replacementText: value } : current,
                    );
                  }}
                  rows={2}
                  required
                />
              </label>
            )}
            <label className="plan-annotation-composer-field">
              <span>{bodyLabel(annotationComposer.type)}</span>
              <textarea
                value={annotationComposer.body}
                ref={
                  !requiresReplacementText(annotationComposer.type)
                    ? annotationComposerFirstFieldRef
                    : undefined
                }
                onChange={(event) => {
                  const { value } = event.currentTarget;
                  setAnnotationComposer((current) =>
                    current ? { ...current, body: value } : current,
                  );
                }}
                rows={annotationComposer.type === 'replacement' ? 2 : 3}
                required={requiresBody(annotationComposer.type)}
              />
            </label>
            {composerError && (
              <div className="plan-annotation-composer-error" role="alert">
                {composerError}
              </div>
            )}
            <div className="plan-annotation-composer-actions">
              <button type="button" onClick={dismissAnnotationComposer}>
                Cancel
              </button>
              <button type="submit" disabled={!canSubmitAnnotationComposer}>
                Add
              </button>
            </div>
          </form>
        )}

        {/* Body */}
        {renderMode === 'markdown' ? (
          <article
            ref={(node) => {
              bodyRef.current = node;
            }}
            className="plan-markdown"
            onMouseUp={updateSelectionToolbar}
            onKeyUp={updateSelectionToolbar}
          >
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
            <pre
              ref={(node) => {
                bodyRef.current = node;
              }}
              className="plan-plain"
              onMouseUp={updateSelectionToolbar}
              onKeyUp={updateSelectionToolbar}
            >
              {renderContent}
            </pre>
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
    </div>
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
        className="absolute flex text-[var(--success)] transition-[opacity,transform] duration-200 ease-in-out"
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
      className="scroll-to-top fixed bottom-7 right-7 w-[38px] h-[38px] rounded-[10px] border border-border bg-surface text-secondary cursor-pointer flex items-center justify-center shadow-[0_2px_12px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.02)] z-50 transition-[opacity,transform,border-color,background-color] duration-200"
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

function MachineIcon() {
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
        d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0V12a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 12V5.25"
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
        d="M18 13v6a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 19V8.25A2.25 2.25 0 0 1 6 6h6"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 3h6v6" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 13.5 21 3" />
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

function ChartIcon() {
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
        d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0 0 20.25 18V6A2.25 2.25 0 0 0 18 3.75H6A2.25 2.25 0 0 0 3.75 6v12A2.25 2.25 0 0 0 6 20.25Z"
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
