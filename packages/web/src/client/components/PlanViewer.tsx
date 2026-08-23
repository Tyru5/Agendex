import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Markdown from 'react-markdown';
import { useFullscreen } from '../hooks/useFullscreen.ts';
import { usePlanAnnotationHighlights } from '../hooks/usePlanAnnotationHighlights.ts';
import { usePlanPathNavigation } from '../hooks/usePlanPathNavigation.ts';
import { useValidatedPlanPaths } from '../hooks/useValidatedPlanPaths.ts';
import { getAgentLabel } from '../lib/agent-colors.ts';
import {
  createPlanTextAnchor,
  type PlanAnnotationKind,
  type PlanAnnotationRecord,
  type PlanTextAnchor,
} from '../lib/annotations.ts';
import type { Plan } from '../lib/api.ts';
import { buildPlanOutline } from '../lib/extract-headings.ts';
import {
  getRelatedPlans,
  type LineageConfidence,
  type LineageRelation,
  type RelatedPlanEntry,
} from '../lib/plan-lineage.ts';
import { extractSyncOrigin, formatSyncOriginLabel } from '../lib/sync-origin.ts';
import { AgentIcon } from './AgentIcon.tsx';
import { ExitFullscreenIcon, FullscreenIcon } from './FullscreenIcons.tsx';
import { CompareIcon } from './PlanCompareView.tsx';
import { PlanComparePicker } from './PlanComparePicker.tsx';
import {
  planMarkdownComponents,
  planMarkdownRehypePlugins,
  planMarkdownRemarkPlugins,
} from './markdownRenderConfig.ts';
import { PlanActionButton } from './PlanActionButton.tsx';
import { PlanDownloadButton } from './PlanDownloadButton.tsx';
import { PlanOutline } from './PlanOutline.tsx';
import { PlanPathContext } from './PlanPathContext.tsx';
import { TechDependencyChart } from './TechDependencyChart.tsx';

export { PlanActionButton } from './PlanActionButton.tsx';

function extractWorkspace(plan: Plan): string | undefined {
  return plan.workspace || undefined;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
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

type RenderedSelectionToolbarState = SelectionToolbarState & {
  phase: 'enter' | 'exit';
};

type AnnotationComposerState = {
  type: PlanAnnotationKind;
  body: string;
  replacementText: string;
};

type ActionToolbarDockState = 'inline' | 'docking' | 'docked';

const ANNOTATION_SELECTION_BLOCKED_TAGS = 'code, pre, script, style, textarea, input, mark';
const ACTION_TOOLBAR_DOCKED_GAP = 12;
const ACTION_TOOLBAR_EXPANDED_CHART_LEFT = 16;
const PLAN_LAYOUT_CHANGE_EVENT = 'agendex:plan-layout-change';
const SELECTION_TOOLBAR_EXIT_MS = 160;

function isVerticalScrollContainer(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return /(auto|scroll|overlay)/.test(style.overflowY);
}

function findScrollParent(element: HTMLElement): HTMLElement | Window {
  const mainScroll = element.closest('.main-scroll');
  if (mainScroll instanceof HTMLElement && isVerticalScrollContainer(mainScroll)) {
    return mainScroll;
  }

  let parent = element.parentElement;
  while (parent) {
    if (isVerticalScrollContainer(parent)) return parent;
    parent = parent.parentElement;
  }
  return window;
}

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

function lineageSectionTitle(confidence: LineageConfidence | undefined): string {
  if (confidence === 'workspace-fallback') return 'Nearby in workspace';
  if (confidence === 'thread') return 'Session thread';
  return 'Same session';
}

function lineageRelationLabel(relation: LineageRelation): string | undefined {
  if (relation === 'parent') return 'Parent';
  if (relation === 'child') return 'Child';
  if (relation === 'self') return 'Current';
  return undefined;
}

function PlanLineageSection({
  entries,
  confidence,
  onSelectRelatedPlan,
  onComparePlan,
}: {
  entries: RelatedPlanEntry[];
  confidence: LineageConfidence | undefined;
  onSelectRelatedPlan?: (plan: Plan) => void;
  onComparePlan?: (plan: Plan) => void;
}) {
  return (
    <section className="plan-lineage" aria-label={lineageSectionTitle(confidence)}>
      <div className="plan-lineage-heading">
        <span className="plan-lineage-title">{lineageSectionTitle(confidence)}</span>
        {confidence === 'workspace-fallback' && (
          <span className="plan-lineage-hint">Approximate match</span>
        )}
      </div>
      <ol className="plan-lineage-list">
        {entries.map((entry) => {
          const relationLabel = lineageRelationLabel(entry.relation);
          const isSelf = entry.relation === 'self';
          const content = (
            <>
              <span className="plan-lineage-item-title">{entry.plan.title}</span>
              <span className="plan-lineage-item-meta">
                {relationLabel && (
                  <span className="plan-lineage-item-relation">{relationLabel}</span>
                )}
                <span>{timeAgo(entry.plan.createdAt)}</span>
              </span>
            </>
          );

          return (
            <li
              key={entry.plan.id}
              className={
                isSelf ? 'plan-lineage-item plan-lineage-item--current' : 'plan-lineage-item'
              }
            >
              {isSelf || !onSelectRelatedPlan ? (
                <div className="plan-lineage-item-body" aria-current={isSelf ? 'true' : undefined}>
                  {content}
                </div>
              ) : (
                <button
                  type="button"
                  className="plan-lineage-item-body plan-lineage-item-button"
                  onClick={() => onSelectRelatedPlan(entry.plan)}
                >
                  {content}
                </button>
              )}
              {!isSelf && onComparePlan && (
                <button
                  type="button"
                  className="plan-lineage-item-compare"
                  onClick={() => onComparePlan(entry.plan)}
                  aria-label={`Compare "${entry.plan.title}" with the current plan`}
                  title="Compare with current plan"
                >
                  <CompareIcon />
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

type PlanViewerProps = {
  plan: Plan;
  /** Full indexed plan list used to resolve session lineage. */
  allPlans?: readonly Plan[];
  onSelectRelatedPlan?: (plan: Plan) => void;
  /** Enables compare affordances; called with the plan to diff against. */
  onComparePlan?: (plan: Plan) => void;
  headerExtra?: ReactNode;
  actionToolbarExtra?: ReactNode;
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
  allPlans,
  onSelectRelatedPlan,
  onComparePlan,
  headerExtra,
  actionToolbarExtra,
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
  const [renderedSelectionToolbar, setRenderedSelectionToolbar] =
    useState<RenderedSelectionToolbarState | null>(null);
  const [annotationComposer, setAnnotationComposer] = useState<AnnotationComposerState | null>(
    null,
  );
  const [annotationComposerError, setAnnotationComposerError] = useState<string | undefined>();
  const bodyRef = useRef<HTMLElement | null>(null);
  const annotationOverlayRef = useRef<HTMLElement | null>(null);
  const annotationComposerFirstFieldRef = useRef<HTMLTextAreaElement | null>(null);
  const selectionToolbarExitTimeoutRef = useRef<number | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const actionToolbarRef = useRef<HTMLDivElement | null>(null);
  const actionToolbarDockTargetRef = useRef(false);
  const actionToolbarDockStateRef = useRef<ActionToolbarDockState>('inline');
  const actionToolbarDockFrameRef = useRef<number | null>(null);
  const [actionToolbarDockState, setActionToolbarDockState] =
    useState<ActionToolbarDockState>('inline');
  const [actionToolbarDockLeft, setActionToolbarDockLeft] = useState<number | null>(null);
  const [chartWide, setChartWide] = useState(false);
  const [comparePickerOpen, setComparePickerOpen] = useState(false);
  const fullscreen = useFullscreen<HTMLDivElement>();
  const isSplit = mode === 'split';

  const clearActionToolbarDockFrame = useCallback(() => {
    if (actionToolbarDockFrameRef.current === null) return;
    window.cancelAnimationFrame(actionToolbarDockFrameRef.current);
    actionToolbarDockFrameRef.current = null;
  }, []);

  const commitActionToolbarDockState = useCallback((nextState: ActionToolbarDockState) => {
    actionToolbarDockStateRef.current = nextState;
    setActionToolbarDockState(nextState);
  }, []);

  const handleTechChartWideChange = useCallback(
    (wide: boolean) => {
      setChartWide(wide);
      onChartWideChange?.(wide);
      window.dispatchEvent(new Event(PLAN_LAYOUT_CHANGE_EVENT));
    },
    [onChartWideChange],
  );

  const handleCopy = async () => {
    await navigator.clipboard.writeText(plan.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const workspace = extractWorkspace(plan);
  const syncOrigin = extractSyncOrigin(plan);
  const lineage = useMemo(
    () => (allPlans ? getRelatedPlans(plan, allPlans) : null),
    [allPlans, plan],
  );
  const lineageConfidence = useMemo((): LineageConfidence | undefined => {
    if (!lineage?.hasRelated) return undefined;
    const related = lineage.items.filter((entry) => entry.relation !== 'self');
    if (related.some((entry) => entry.confidence === 'session')) return 'session';
    if (related.some((entry) => entry.confidence === 'thread')) return 'thread';
    return related[0]?.confidence ?? 'workspace-fallback';
  }, [lineage]);

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

  const planPaths = useValidatedPlanPaths(plan, renderMode === 'markdown' ? renderContent : '');

  const pathValidationKey = useMemo(() => {
    if (!planPaths) return '';
    const local = Object.keys(planPaths.results)
      .sort()
      .map((path) => {
        const result = planPaths.results[path];
        if (!result) return `${path}:missing`;
        if (result.status === 'found') return `${path}:found:${result.relative}`;
        if (result.status === 'ambiguous') return `${path}:ambiguous:${result.matches.join(',')}`;
        return `${path}:${result.status}`;
      })
      .join('|');
    const remote = Object.entries(planPaths.remoteTargets)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, target]) => `${path}:remote:${target.url}`)
      .join('|');
    return `${local}|${remote}`;
  }, [planPaths]);

  usePlanPathNavigation({
    rootRef: bodyRef,
    enabled: planPaths?.status === 'ready',
    // Reset focus when the plan, markdown, or validated path set changes.
    contentKey: `${plan.id}\0${renderContent}\0${pathValidationKey}`,
  });

  const annotationComposerType = annotationComposer?.type;

  useEffect(() => {
    if (!annotationComposerType) return;
    annotationComposerFirstFieldRef.current?.focus();
  }, [annotationComposerType]);

  useEffect(() => {
    if (selectionToolbar && !annotationComposer) {
      if (selectionToolbarExitTimeoutRef.current !== null) {
        window.clearTimeout(selectionToolbarExitTimeoutRef.current);
        selectionToolbarExitTimeoutRef.current = null;
      }
      setRenderedSelectionToolbar({ ...selectionToolbar, phase: 'enter' });
      return;
    }

    setRenderedSelectionToolbar((current) => {
      if (!current || current.phase === 'exit') return current;

      if (selectionToolbarExitTimeoutRef.current !== null) {
        window.clearTimeout(selectionToolbarExitTimeoutRef.current);
      }
      selectionToolbarExitTimeoutRef.current = window.setTimeout(() => {
        selectionToolbarExitTimeoutRef.current = null;
        setRenderedSelectionToolbar(null);
      }, SELECTION_TOOLBAR_EXIT_MS);

      return { ...current, phase: 'exit' };
    });
  }, [annotationComposer, selectionToolbar]);

  useEffect(() => {
    return () => {
      if (selectionToolbarExitTimeoutRef.current !== null) {
        window.clearTimeout(selectionToolbarExitTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setChartWide(false);
  }, [plan.id, chartHidden]);

  useEffect(() => {
    setComparePickerOpen(false);
  }, [plan.id]);

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

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    let scrollTarget: HTMLElement | Window = findScrollParent(frame);
    let animationFrame = 0;

    const scheduleUpdate = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(updateDockedState);
    };

    const attachScrollListener = () => {
      scrollTarget.addEventListener('scroll', scheduleUpdate, { passive: true });
    };

    const syncScrollListener = () => {
      const nextScrollTarget = findScrollParent(frame);
      if (nextScrollTarget === scrollTarget) return;

      scrollTarget.removeEventListener('scroll', scheduleUpdate);
      scrollTarget = nextScrollTarget;
      attachScrollListener();
    };

    const startDocking = () => {
      actionToolbarDockTargetRef.current = true;

      const currentState = actionToolbarDockStateRef.current;
      if (currentState === 'docked' || currentState === 'docking') return;

      clearActionToolbarDockFrame();
      commitActionToolbarDockState('docking');
      actionToolbarDockFrameRef.current = window.requestAnimationFrame(() => {
        actionToolbarDockFrameRef.current = window.requestAnimationFrame(() => {
          actionToolbarDockFrameRef.current = null;
          if (actionToolbarDockTargetRef.current) commitActionToolbarDockState('docked');
        });
      });
    };

    const startUndocking = () => {
      actionToolbarDockTargetRef.current = false;
      clearActionToolbarDockFrame();

      const currentState = actionToolbarDockStateRef.current;
      if (currentState === 'inline') return;

      commitActionToolbarDockState('inline');
    };

    const transitionDockState = (shouldDock: boolean) => {
      if (shouldDock) {
        startDocking();
        return;
      }
      startUndocking();
    };

    const updateDockedState = () => {
      animationFrame = 0;
      syncScrollListener();
      const scrollParent = scrollTarget;
      const frameRect = frame.getBoundingClientRect();
      const toolbarRect = actionToolbarRef.current?.getBoundingClientRect();
      const toolbarWidth = toolbarRect?.width ?? 38;
      const scrollParentRect =
        scrollParent === window ? null : scrollParent.getBoundingClientRect();
      const viewportTop = scrollParentRect?.top ?? 0;
      const viewportLeft = scrollParentRect?.left ?? 0;
      const shouldDock = !isSplit && frameRect.top < viewportTop - 118;
      const shell = frame.closest('.plannotator-review-shell');
      const leftRailRect = shell
        ?.querySelector('.plannotator-review-rail--left')
        ?.getBoundingClientRect();
      const leftRailGuard =
        shouldDock &&
        !fullscreen.isFullscreen &&
        leftRailRect &&
        leftRailRect.width > 0 &&
        leftRailRect.right <= frameRect.left &&
        leftRailRect.bottom > viewportTop
          ? leftRailRect.right + ACTION_TOOLBAR_DOCKED_GAP
          : 20;
      const nextDockLeft = Math.max(
        20,
        leftRailGuard,
        shouldDock
          ? chartWide
            ? viewportLeft + ACTION_TOOLBAR_EXPANDED_CHART_LEFT
            : frameRect.left - toolbarWidth - ACTION_TOOLBAR_DOCKED_GAP
          : (toolbarRect?.left ?? 20),
      );
      setActionToolbarDockLeft((current) =>
        current !== null && Math.abs(current - nextDockLeft) < 0.5 ? current : nextDockLeft,
      );
      transitionDockState(shouldDock);
    };

    const scheduleSettledUpdate = () => {
      scheduleUpdate();
      window.requestAnimationFrame(() => window.requestAnimationFrame(scheduleUpdate));
    };

    const observedElements = [
      frame,
      actionToolbarRef.current,
      fullscreen.ref.current,
      frame.closest('.plannotator-review-shell'),
      frame.closest('.main-scroll'),
      frame.closest('.agendex-main-pane'),
    ].filter((element): element is Element => Boolean(element));
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => scheduleSettledUpdate());
    observedElements.forEach((element) => resizeObserver?.observe(element));

    attachScrollListener();
    updateDockedState();
    window.addEventListener('resize', scheduleSettledUpdate);
    window.addEventListener(PLAN_LAYOUT_CHANGE_EVENT, scheduleSettledUpdate);

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      clearActionToolbarDockFrame();
      resizeObserver?.disconnect();
      scrollTarget.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleSettledUpdate);
      window.removeEventListener(PLAN_LAYOUT_CHANGE_EVENT, scheduleSettledUpdate);
    };
  }, [
    chartHidden,
    chartWide,
    clearActionToolbarDockFrame,
    commitActionToolbarDockState,
    fullscreen.isFullscreen,
    fullscreen.ref,
    isSplit,
    plan.id,
  ]);

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
  const isActionToolbarDocked = actionToolbarDockState !== 'inline' && !isSplit;
  const actionToolbarDockPlacement = isActionToolbarDocked ? 'bottom' : undefined;
  const actionToolbarStyle =
    actionToolbarDockLeft === null
      ? undefined
      : ({
          '--plan-action-toolbar-docked-left': `${actionToolbarDockLeft}px`,
        } as CSSProperties);
  const viewerStyle = fullscreen.isFullscreen
    ? ({ background: 'var(--bg)', overflow: 'auto', height: '100%' } as CSSProperties)
    : undefined;

  const actionToolbar = (
    <div
      ref={actionToolbarRef}
      className="plan-action-toolbar"
      data-docked={isActionToolbarDocked ? 'true' : undefined}
      data-dock-placement={actionToolbarDockPlacement}
      data-dock-state={actionToolbarDockState}
      data-tooltip-side={
        actionToolbarDockPlacement === 'bottom'
          ? 'top'
          : actionToolbarDockPlacement === 'side'
            ? 'left'
            : undefined
      }
      aria-label="Plan actions"
      style={actionToolbarStyle}
    >
      <PlanActionButton
        onClick={handleCopy}
        label={copied ? 'Plan copied' : 'Copy plan'}
        tooltip={copied ? 'Copied' : 'Copy plan'}
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
      </PlanActionButton>
      <PlanDownloadButton plan={plan} />
      {onComparePlan && allPlans && allPlans.length > 1 && (
        <PlanActionButton
          onClick={() => setComparePickerOpen(true)}
          label="Compare with another plan"
          tooltip="Compare plans"
        >
          <CompareIcon />
        </PlanActionButton>
      )}
      {actionToolbarExtra}
      {onEdit && (
        <PlanActionButton onClick={onEdit} label="Edit plan">
          <EditIcon />
        </PlanActionButton>
      )}
      {onShare && (
        <PlanActionButton onClick={onShare} label="Share plan">
          <ShareIcon />
        </PlanActionButton>
      )}
      {onHistory && (
        <PlanActionButton onClick={onHistory} label="Version history">
          <HistoryIcon />
        </PlanActionButton>
      )}
      {onToggleChart && (
        <PlanActionButton
          onClick={onToggleChart}
          label={chartHidden ? 'Show tech chart' : 'Hide tech chart'}
          tooltip={chartHidden ? 'Show tech chart (⇧⌘G)' : 'Hide tech chart (⇧⌘G)'}
          pressed={!chartHidden}
        >
          <ChartIcon />
        </PlanActionButton>
      )}
      <PlanActionButton
        onClick={() => fullscreen.toggle()}
        label={fullscreen.isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        tooltip={fullscreen.isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
      >
        {fullscreen.isFullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
      </PlanActionButton>
    </div>
  );

  return (
    <div
      ref={fullscreen.ref}
      style={viewerStyle}
      className={fullscreen.isFullscreen ? 'main-scroll' : undefined}
      data-chart-wide={chartWide ? 'true' : undefined}
    >
      {showOutline && !isSplit && <PlanOutline entries={entries} pinned={!outlineHidden} />}
      <div
        ref={frameRef}
        className={isSplit ? 'plan-viewer-frame plan-viewer-frame--split' : 'plan-viewer-frame'}
      >
        <div className="plan-viewer-content">
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
              {headerExtra ? (
                <div className="plan-header-extra">
                  {headerExtra}
                  {actionToolbar}
                </div>
              ) : (
                actionToolbar
              )}
            </div>

            {lineage?.hasRelated && (
              <PlanLineageSection
                entries={lineage.items}
                confidence={lineageConfidence}
                onSelectRelatedPlan={onSelectRelatedPlan}
                onComparePlan={onComparePlan}
              />
            )}
          </header>

          {onChartWideChange && !chartHidden && (
            <div style={{ marginTop: '8px', marginBottom: '24px' }}>
              <TechDependencyChart plan={plan} onWideChange={handleTechChartWideChange} />
            </div>
          )}

          {showAnnotationUpgrade && (
            <div className="plan-annotation-upgrade" role="note">
              {annotationUpgradeMessage}
            </div>
          )}

          {renderedSelectionToolbar && (
            <div
              ref={(node) => {
                if (!annotationComposer) annotationOverlayRef.current = node;
              }}
              className="plan-annotation-toolbar"
              data-state={renderedSelectionToolbar.phase}
              role="toolbar"
              aria-label="Create plan annotation"
              style={{ top: renderedSelectionToolbar.top, left: renderedSelectionToolbar.left }}
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
          {planPaths?.status === 'unavailable' && (
            <div className="plan-path-status" role="status">
              {planPaths.statusMessage}
            </div>
          )}
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
              <PlanPathContext.Provider value={planPaths}>
                <Markdown
                  remarkPlugins={planMarkdownRemarkPlugins}
                  rehypePlugins={planMarkdownRehypePlugins}
                  components={planMarkdownComponents}
                >
                  {renderContent}
                </Markdown>
              </PlanPathContext.Provider>
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

      {onComparePlan && allPlans && (
        <PlanComparePicker
          open={comparePickerOpen}
          onClose={() => setComparePickerOpen(false)}
          currentPlan={plan}
          plans={allPlans}
          relatedPlans={lineage?.items
            .filter((entry) => entry.relation !== 'self')
            .map((entry) => entry.plan)}
          onPick={(picked) => {
            setComparePickerOpen(false);
            onComparePlan(picked);
          }}
        />
      )}
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
