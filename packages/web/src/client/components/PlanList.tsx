import type { PlanReceiptSummary } from '@agendex/shared/receipts';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import { usePlanState } from '../hooks/usePlanState.ts';
import { getAgentLabel } from '../lib/agent-colors.ts';
import type { Plan } from '../lib/api.ts';
import { splitCustomDirPlans } from '../lib/custom-plan-tree.ts';
import type { FolderState } from '../lib/plan-folders.ts';
import { plansWithSessionSiblings } from '../lib/plan-lineage.ts';
import {
  RECEIPT_STATUS_LABEL,
  receiptSummaryForPlan,
  receiptTagStatus,
} from '../lib/plan-receipt-format.ts';
import type { PlanState } from '../lib/plan-state.ts';
import { AgentIcon } from './AgentIcon.tsx';
import { CustomDirTree } from './CustomDirTree.tsx';
import { FolderTree, MoveToFolderMenu } from './FolderTree.tsx';
import { ReceiptStatusIcon } from './ReceiptStatusIcon.tsx';

function timeAgo(dateStr: string, now: number): string {
  const diff = now - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

// One shared clock that ticks each minute, so memoized rows keep their relative
// timestamps current without re-rendering the whole row.
const minuteClockListeners = new Set<() => void>();
let minuteClockTimer: ReturnType<typeof setInterval> | undefined;
let minuteClockNow = Date.now();

function subscribeMinuteClock(listener: () => void): () => void {
  minuteClockListeners.add(listener);
  if (!minuteClockTimer) {
    minuteClockNow = Date.now();
    minuteClockTimer = setInterval(() => {
      minuteClockNow = Date.now();
      for (const notify of minuteClockListeners) notify();
    }, 60_000);
  }
  return () => {
    minuteClockListeners.delete(listener);
    if (minuteClockListeners.size === 0 && minuteClockTimer) {
      clearInterval(minuteClockTimer);
      minuteClockTimer = undefined;
    }
  };
}

function RelativeTime({ date }: { date: string }) {
  const now = useSyncExternalStore(
    subscribeMinuteClock,
    () => minuteClockNow,
    () => minuteClockNow,
  );
  return <span>{timeAgo(date, now)}</span>;
}

type PlanRowProps = {
  plan: Plan;
  selected: boolean;
  unseen: boolean;
  hasSessionSiblings?: boolean;
  /** Local receipt summary; only landed, in progress, and stalled show a tag. */
  receipt?: PlanReceiptSummary;
  /** Stable across renders and rows so `memo` can skip rows whose data did not change. */
  onSelectPlan: (plan: Plan) => void;
  isSplit?: boolean;
  onPlanContextMenu?: (e: React.MouseEvent<HTMLElement>, plan: Plan) => void;
  onPlanMenuKey?: (e: React.KeyboardEvent<HTMLButtonElement>, plan: Plan) => void;
  isRenaming?: boolean;
  renameValue?: string;
  onRenameChange?: (value: string) => void;
  onRenameSubmit?: () => void;
  onRenameCancel?: () => void;
  onPlanKeyDown?: (e: React.KeyboardEvent<HTMLButtonElement>, plan: Plan) => void;
  keyShortcuts?: string;
};

function isContextMenuKey(e: React.KeyboardEvent) {
  return e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey);
}

const PlanRow = memo(function PlanRow({
  plan,
  selected,
  unseen,
  hasSessionSiblings,
  receipt,
  onSelectPlan,
  isSplit,
  onPlanContextMenu,
  onPlanMenuKey,
  isRenaming,
  renameValue,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  onPlanKeyDown,
  keyShortcuts,
}: PlanRowProps) {
  const titleRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    setOverflows(el.scrollWidth > el.clientWidth);
  }, [isRenaming, plan.title]);

  useEffect(() => {
    if (isRenaming) renameInputRef.current?.focus();
  }, [isRenaming]);

  const receiptStatus = receiptTagStatus(receipt);
  const className = `w-full text-left block plan-row sidebar-plan-row${selected ? ' plan-row--selected' : ''}${isSplit ? ' plan-row--split' : ''} font-[inherit]`;
  const style = {
    background: selected ? 'var(--active)' : isSplit ? 'var(--hover)' : 'transparent',
    border: isSplit ? '1px dashed var(--border)' : undefined,
  };
  const meta = (
    <div className="sidebar-plan-meta">
      <AgentIcon agent={plan.agent} size={10} />
      <span className="sidebar-plan-meta-label">{getAgentLabel(plan.agent)}</span>
      <span aria-hidden="true">·</span>
      <RelativeTime date={plan.updatedAt} />
      {hasSessionSiblings && (
        <>
          <span aria-hidden="true">·</span>
          <span className="sidebar-plan-session" title="Shares a session with other plans">
            session
          </span>
        </>
      )}
      {receiptStatus && (
        <span className="sidebar-plan-receipt" data-status={receiptStatus}>
          <ReceiptStatusIcon status={receiptStatus} size={10} />
          {RECEIPT_STATUS_LABEL[receiptStatus]}
        </span>
      )}
    </div>
  );

  // While renaming, the row is a plain container: an input must not live inside a <button>.
  if (isRenaming) {
    return (
      <div className={className} style={style}>
        <input
          ref={renameInputRef}
          type="text"
          aria-label={`Rename ${plan.title}`}
          value={renameValue ?? ''}
          onChange={(e) => onRenameChange?.(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') onRenameSubmit?.();
            if (e.key === 'Escape') onRenameCancel?.();
          }}
          onBlur={() => onRenameCancel?.()}
          className="w-full text-[13px] font-medium font-[inherit] bg-transparent border border-border rounded-[5px] px-1.5 py-0.5 outline-none text-text"
          style={{ lineHeight: '1.35' }}
        />
        {meta}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelectPlan(plan)}
      onContextMenu={onPlanContextMenu ? (e) => onPlanContextMenu(e, plan) : undefined}
      onKeyDown={(e) => {
        if (onPlanMenuKey && isContextMenuKey(e)) {
          onPlanMenuKey(e, plan);
          return;
        }
        onPlanKeyDown?.(e, plan);
      }}
      aria-haspopup={onPlanMenuKey ? 'menu' : undefined}
      aria-keyshortcuts={
        [keyShortcuts, onPlanMenuKey ? 'Shift+F10 ContextMenu' : undefined]
          .filter(Boolean)
          .join(' ') || undefined
      }
      title={overflows ? plan.title : undefined}
      className={`${className} cursor-pointer`}
      style={style}
    >
      <div
        ref={titleRef}
        className={`plan-title${overflows ? ' plan-title--fade' : ''}`}
        style={{ paddingLeft: unseen ? '14px' : undefined }}
      >
        {unseen && <span className="sidebar-unread-dot" />}
        {plan.title}
      </div>
      {meta}
    </button>
  );
});

function MenuButton({
  label,
  danger = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      disabled={disabled}
      onClick={onClick}
      className="plan-context-menu-item"
      style={{
        width: '100%',
        textAlign: 'left',
        padding: '8px 12px',
        fontSize: '13px',
        fontWeight: 450,
        fontFamily: 'inherit',
        borderRadius: '7px',
        border: 'none',
        color: disabled ? 'var(--tertiary)' : danger ? 'var(--danger)' : 'var(--text)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

/** Portal menu with roving focus: arrows/Home/End move, Escape or Tab closes. */
function PlanContextMenu({
  x,
  y,
  label,
  onDismiss,
  children,
}: {
  x: number;
  y: number;
  label: string;
  onDismiss: (restoreFocus: boolean) => void;
  children: React.ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  const items = () =>
    Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ??
        [],
    );

  useEffect(() => {
    (items()[0] ?? menuRef.current)?.focus({ preventScroll: true });
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    let next: HTMLButtonElement | undefined;
    if (e.key === 'ArrowDown') next = list[(index + 1) % list.length];
    else if (e.key === 'ArrowUp') next = list[(index - 1 + list.length) % list.length];
    else if (e.key === 'Home') next = list[0];
    else if (e.key === 'End') next = list[list.length - 1];
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onDismiss(true);
      return;
    } else if (e.key === 'Tab') {
      e.preventDefault();
      onDismiss(true);
      return;
    }
    if (!next) return;
    e.preventDefault();
    next.focus({ preventScroll: true });
  }

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      aria-label={label}
      className="plan-context-menu"
      style={{
        position: 'fixed',
        top: y,
        left: x,
        zIndex: 50,
        minWidth: '196px',
        padding: '4px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '10px',
        boxShadow: 'var(--shadow-popover)',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>,
    document.body,
  );
}

type MoveControl = 'row' | 'up' | 'down';

const MOVE_SHORTCUTS = 'Alt+ArrowUp Alt+ArrowDown';

function MoveIcon({ direction }: { direction: 'up' | 'down' }) {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={direction === 'up' ? 'M4 10l4-4 4 4' : 'M4 6l4 4 4-4'} />
    </svg>
  );
}

function ReorderablePlanRow({
  plan,
  above,
  below,
  onMove,
  children,
}: {
  plan: Plan;
  above: Plan | undefined;
  below: Plan | undefined;
  onMove: (planId: string, targetPlanId: string, control: MoveControl) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="sidebar-reorder-row" data-reorder-plan={plan.id}>
      {children}
      <div className="sidebar-reorder-actions">
        <button
          type="button"
          className="sidebar-reorder-action"
          data-reorder-control="up"
          disabled={!above}
          aria-label={`Move ${plan.title} up`}
          title="Move up"
          onClick={() => above && onMove(plan.id, above.id, 'up')}
        >
          <MoveIcon direction="up" />
        </button>
        <button
          type="button"
          className="sidebar-reorder-action"
          data-reorder-control="down"
          disabled={!below}
          aria-label={`Move ${plan.title} down`}
          title="Move down"
          onClick={() => below && onMove(plan.id, below.id, 'down')}
        >
          <MoveIcon direction="down" />
        </button>
      </div>
    </div>
  );
}

type PlanListProps = {
  plans: Plan[];
  selectedId: string | undefined;
  onSelect: (plan: Plan | undefined) => void;
  isPro?: boolean;
  splitPlanId?: string;
  onOpenInSplitView?: (plan: Plan) => void;
  planState?: PlanState;
  onRenamePlan?: (planId: string, newTitle: string) => void;
  onDeletePlan?: (planId: string) => void;
  onRemoveCustomDir?: (dir: string) => void | Promise<void>;
  /** All configured custom plan source paths — ensures empty / file-path sources are visible. */
  customPlanDirs?: readonly string[];
  folderState?: FolderState;
  emptyState?: {
    title: string;
    actionLabel: string;
    onAction: () => void;
  };
  /**
   * Collection order mode: renders `plans` as one flat list in the given order and offers
   * Move up / Move down, which move a plan into its visible neighbour's slot.
   */
  onMovePlan?: (planId: string, targetPlanId: string) => void;
  /** Receipt summaries keyed by local plan id, from `usePlanReceiptSummaries`. */
  receipts?: Readonly<Record<string, PlanReceiptSummary>>;
};

export function PlanList(props: PlanListProps) {
  const {
    plans,
    selectedId,
    onSelect,
    isPro = false,
    splitPlanId,
    onOpenInSplitView,
    planState: planStateProp,
    onRenamePlan,
    onDeletePlan,
    onRemoveCustomDir,
    customPlanDirs,
    folderState,
    emptyState,
    onMovePlan,
    receipts,
  } = props;
  const localPlanState = usePlanState();
  const planState = planStateProp ?? localPlanState;
  const [contextMenu, setContextMenu] = useState<{ plan: Plan; x: number; y: number } | null>(null);
  const [moveToFolderMenu, setMoveToFolderMenu] = useState<{
    planId: string;
    x: number;
    y: number;
  } | null>(null);
  const [renamingPlanId, setRenamingPlanId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const lastAutoSeenKeyRef = useRef<string | null>(null);
  const sessionSiblingIds = useMemo(() => plansWithSessionSiblings(plans), [plans]);

  const menuTriggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    function handleClose() {
      setContextMenu(null);
    }
    window.addEventListener('pointerdown', handleClose);
    window.addEventListener('scroll', handleClose, true);
    window.addEventListener('resize', handleClose);
    return () => {
      window.removeEventListener('pointerdown', handleClose);
      window.removeEventListener('scroll', handleClose, true);
      window.removeEventListener('resize', handleClose);
    };
  }, [contextMenu]);

  /** Close the row menu and, by default, return focus to the row that opened it. */
  const closeContextMenu = useCallback((restoreFocus = true) => {
    setContextMenu(null);
    const trigger = menuTriggerRef.current;
    menuTriggerRef.current = null;
    if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
  }, []);

  /** Row that opened the folder submenu, focused again when the submenu closes. */
  const moveMenuTriggerRef = useRef<HTMLElement | null>(null);

  /** Hand focus from the row menu to the folder submenu instead of back to the row. */
  const openMoveToFolderMenu = useCallback(
    (menu: { plan: Plan; x: number; y: number }) => {
      moveMenuTriggerRef.current = menuTriggerRef.current;
      setMoveToFolderMenu({ planId: menu.plan.id, x: menu.x + 196, y: menu.y });
      closeContextMenu(false);
    },
    [closeContextMenu],
  );

  const closeMoveToFolderMenu = useCallback(() => {
    setMoveToFolderMenu(null);
    const trigger = moveMenuTriggerRef.current;
    moveMenuTriggerRef.current = null;
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  }, []);

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === selectedId),
    [plans, selectedId],
  );

  useEffect(() => {
    if (!isPro) return;
    if (!selectedPlan) {
      lastAutoSeenKeyRef.current = null;
      return;
    }
    const nextKey = `${selectedPlan.id}:${selectedPlan.updatedAt}`;
    if (lastAutoSeenKeyRef.current === nextKey) return;
    lastAutoSeenKeyRef.current = nextKey;
    planState.markSeen(selectedPlan.id, selectedPlan.updatedAt);
  }, [selectedPlan, planState, isPro]);

  // Collection order renders every plan, custom-source ones included, as one ordered list.
  const { customDirPlans, nonCustomPlans } = useMemo(
    () => splitCustomDirPlans(plans, { ordered: Boolean(onMovePlan) }),
    [plans, onMovePlan],
  );

  const { pinnedPlans, unseenPlans, regularPlans } = useMemo(() => {
    if (!isPro || onMovePlan) {
      return { pinnedPlans: [], unseenPlans: [], regularPlans: nonCustomPlans };
    }

    const pinned: Plan[] = [];
    const unseen: Plan[] = [];
    const rest: Plan[] = [];

    for (const plan of nonCustomPlans) {
      const pinnedPlan = planState.isPinned(plan.id);
      const unseenPlan = planState.isUnseen(plan.id, plan.updatedAt);
      if (pinnedPlan) {
        pinned.push(plan);
      } else if (unseenPlan && plan.id !== selectedId) {
        unseen.push(plan);
      } else {
        rest.push(plan);
      }
    }

    return { pinnedPlans: pinned, unseenPlans: unseen, regularPlans: rest };
  }, [nonCustomPlans, planState, selectedId, isPro, onMovePlan]);

  const listRef = useRef<HTMLDivElement>(null);
  const pendingMoveFocusRef = useRef<{ planId: string; control: MoveControl } | null>(null);

  const movePlan = useCallback(
    (planId: string, targetPlanId: string, control: MoveControl) => {
      if (!onMovePlan) return;
      pendingMoveFocusRef.current = { planId, control };
      onMovePlan(planId, targetPlanId);
    },
    [onMovePlan],
  );

  // Reordering can detach the focused row from the DOM; put focus back on the control that moved
  // it (or the row once that control hits an edge) unless focus has already left the list.
  useLayoutEffect(() => {
    const pending = pendingMoveFocusRef.current;
    const list = listRef.current;
    if (!pending || !list) return;
    pendingMoveFocusRef.current = null;
    const active = document.activeElement;
    if (active && active !== document.body && !list.contains(active)) return;
    const row = Array.from(list.querySelectorAll<HTMLElement>('[data-reorder-plan]')).find(
      (element) => element.dataset.reorderPlan === pending.planId,
    );
    const control = row?.querySelector<HTMLButtonElement>(
      `[data-reorder-control="${pending.control}"]`,
    );
    const target = control && !control.disabled ? control : row?.querySelector('button');
    target?.focus();
  }, [regularPlans]);

  function handleMoveKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, plan: Plan) {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const index = regularPlans.findIndex((candidate) => candidate.id === plan.id);
    if (index < 0) return;
    const above = regularPlans[index - 1];
    const below = regularPlans[index + 1];
    const target = e.key === 'ArrowUp' ? above : e.key === 'ArrowDown' ? below : undefined;
    if (!target) return;
    e.preventDefault();
    movePlan(plan.id, target.id, 'row');
  }

  function handleClick(plan: Plan) {
    const nextPlan = plan.id === selectedId ? undefined : plan;
    if (nextPlan && isPro) planState.markSeen(nextPlan.id, nextPlan.updatedAt);
    onSelect(nextPlan);
  }

  function openContextMenuAt(trigger: HTMLElement, plan: Plan, clientX: number, clientY: number) {
    menuTriggerRef.current = trigger;
    const x = Math.max(0, Math.min(clientX, window.innerWidth - 220));
    const y = Math.max(0, Math.min(clientY, window.innerHeight - 120));
    setContextMenu({ plan, x, y });
  }

  function handleContextMenu(e: React.MouseEvent<HTMLElement>, plan: Plan) {
    if (!isPro && !folderState) return;
    e.preventDefault();
    // Keyboard-initiated contextmenu events carry no pointer position; anchor to the row.
    if (e.clientX === 0 && e.clientY === 0) {
      const rect = e.currentTarget.getBoundingClientRect();
      openContextMenuAt(e.currentTarget, plan, rect.left + 12, rect.bottom - 4);
      return;
    }
    openContextMenuAt(e.currentTarget, plan, e.clientX, e.clientY);
  }

  function handleMenuKey(e: React.KeyboardEvent<HTMLButtonElement>, plan: Plan) {
    if (!isPro && !folderState) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    openContextMenuAt(e.currentTarget, plan, rect.left + 12, rect.bottom - 4);
  }

  const startRename = useCallback((plan: Plan) => {
    setRenamingPlanId(plan.id);
    setRenameValue(plan.title);
  }, []);

  const cancelRename = useCallback(() => {
    setRenamingPlanId(null);
    setRenameValue('');
  }, []);

  function handleSubmitRename() {
    const trimmed = renameValue.trim();
    if (renamingPlanId && trimmed && onRenamePlan) {
      onRenamePlan(renamingPlanId, trimmed);
    }
    setRenamingPlanId(null);
    setRenameValue('');
  }

  // Rows are memoized, so every handler they receive must keep one identity across renders
  // (search keystrokes, selection, rename typing). Each delegates to the latest closure.
  const latestHandlers = useRef({
    handleClick,
    handleContextMenu,
    handleMenuKey,
    handleMoveKeyDown,
    handleSubmitRename,
  });
  latestHandlers.current = {
    handleClick,
    handleContextMenu,
    handleMenuKey,
    handleMoveKeyDown,
    handleSubmitRename,
  };
  const selectPlan = useCallback((plan: Plan) => latestHandlers.current.handleClick(plan), []);
  const openPlanContextMenu = useCallback(
    (e: React.MouseEvent<HTMLElement>, plan: Plan) =>
      latestHandlers.current.handleContextMenu(e, plan),
    [],
  );
  const openPlanMenuFromKey = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, plan: Plan) =>
      latestHandlers.current.handleMenuKey(e, plan),
    [],
  );
  const movePlanByKey = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, plan: Plan) =>
      latestHandlers.current.handleMoveKeyDown(e, plan),
    [],
  );
  const submitRename = useCallback(() => latestHandlers.current.handleSubmitRename(), []);
  const menuEnabled = isPro || Boolean(folderState);
  const rowMenuProps = menuEnabled
    ? { onPlanContextMenu: openPlanContextMenu, onPlanMenuKey: openPlanMenuFromKey }
    : {};

  const hasConfiguredSources = Boolean(customPlanDirs?.length);
  if (plans.length === 0 && (emptyState || !hasConfiguredSources)) {
    return (
      <div className="sidebar-empty-state">
        <div>{emptyState?.title ?? 'No plans found'}</div>
        {emptyState && (
          <button type="button" className="sidebar-empty-action" onClick={emptyState.onAction}>
            {emptyState.actionLabel}
          </button>
        )}
      </div>
    );
  }

  const contextPlan = contextMenu?.plan;
  const contextPlanPinned = contextPlan ? planState.isPinned(contextPlan.id) : false;
  const contextPlanUnseen = contextPlan
    ? planState.isUnseen(contextPlan.id, contextPlan.updatedAt)
    : false;
  const splitDisabled = contextPlan ? contextPlan.id === selectedId : false;
  const contextPlanIndex =
    onMovePlan && contextPlan ? regularPlans.findIndex((plan) => plan.id === contextPlan.id) : -1;
  const contextPlanAbove = contextPlanIndex >= 0 ? regularPlans[contextPlanIndex - 1] : undefined;
  const contextPlanBelow = contextPlanIndex >= 0 ? regularPlans[contextPlanIndex + 1] : undefined;

  return (
    <div className="w-full" ref={listRef}>
      {!onMovePlan &&
        (customDirPlans.length > 0 || (customPlanDirs && customPlanDirs.length > 0)) && (
          <>
            <CustomDirTree
              plans={customDirPlans}
              onRemoveSource={onRemoveCustomDir}
              customPlanDirs={customPlanDirs}
              renderPlan={(plan) => (
                <PlanRow
                  key={plan.id}
                  plan={plan}
                  selected={plan.id === selectedId}
                  unseen={isPro && planState.isUnseen(plan.id, plan.updatedAt)}
                  hasSessionSiblings={sessionSiblingIds.has(plan.id)}
                  receipt={receiptSummaryForPlan(receipts, plan)}
                  onSelectPlan={selectPlan}
                  isSplit={isPro && plan.id === splitPlanId}
                  {...rowMenuProps}
                  isRenaming={renamingPlanId === plan.id}
                  renameValue={renamingPlanId === plan.id ? renameValue : undefined}
                  onRenameChange={setRenameValue}
                  onRenameSubmit={submitRename}
                  onRenameCancel={cancelRename}
                />
              )}
            />
            {(pinnedPlans.length > 0 || unseenPlans.length > 0 || regularPlans.length > 0) && (
              <div className="sidebar-ghost-divider" />
            )}
          </>
        )}
      {nonCustomPlans.length > 0 && (
        <div className="sidebar-section-header">
          <span className="sidebar-section-title">
            Plans <span className="sidebar-section-count">({nonCustomPlans.length})</span>
          </span>
        </div>
      )}
      {pinnedPlans.length > 0 && (
        <div className="mb-2">
          <div className="sidebar-section-header">
            <span className="sidebar-section-title">Pinned</span>
            <span className="sidebar-count-pill">{pinnedPlans.length}</span>
          </div>
          {pinnedPlans.map((plan) => (
            <PlanRow
              key={plan.id}
              plan={plan}
              selected={plan.id === selectedId}
              unseen={planState.isUnseen(plan.id, plan.updatedAt)}
              hasSessionSiblings={sessionSiblingIds.has(plan.id)}
              receipt={receiptSummaryForPlan(receipts, plan)}
              onSelectPlan={selectPlan}
              isSplit={plan.id === splitPlanId}
              {...rowMenuProps}
              isRenaming={renamingPlanId === plan.id}
              renameValue={renamingPlanId === plan.id ? renameValue : undefined}
              onRenameChange={setRenameValue}
              onRenameSubmit={submitRename}
              onRenameCancel={cancelRename}
            />
          ))}
          {(unseenPlans.length > 0 || regularPlans.length > 0) && (
            <div className="sidebar-ghost-divider" />
          )}
        </div>
      )}
      {unseenPlans.length > 0 && (
        <div className="mb-2">
          <div className="sidebar-section-header sidebar-section-header--accent">
            <span className="sidebar-section-title">Updated</span>
            <div className="flex items-center gap-2">
              <span className="sidebar-count-pill">{unseenPlans.length}</span>
              <button
                type="button"
                onClick={() => planState.markAllSeen(unseenPlans)}
                className="sidebar-section-action whitespace-nowrap"
              >
                Mark read
              </button>
            </div>
          </div>
          {unseenPlans.map((plan) => (
            <PlanRow
              key={plan.id}
              plan={plan}
              selected={plan.id === selectedId}
              unseen
              hasSessionSiblings={sessionSiblingIds.has(plan.id)}
              receipt={receiptSummaryForPlan(receipts, plan)}
              onSelectPlan={selectPlan}
              isSplit={plan.id === splitPlanId}
              {...rowMenuProps}
              isRenaming={renamingPlanId === plan.id}
              renameValue={renamingPlanId === plan.id ? renameValue : undefined}
              onRenameChange={setRenameValue}
              onRenameSubmit={submitRename}
              onRenameCancel={cancelRename}
            />
          ))}
          {regularPlans.length > 0 && <div className="sidebar-ghost-divider" />}
        </div>
      )}
      {folderState && folderState.folders.length > 0 && !onMovePlan ? (
        <FolderTree
          folderState={folderState}
          plans={regularPlans}
          renderPlan={(plan) => (
            <PlanRow
              key={plan.id}
              plan={plan}
              selected={plan.id === selectedId}
              unseen={isPro && planState.isUnseen(plan.id, plan.updatedAt)}
              hasSessionSiblings={sessionSiblingIds.has(plan.id)}
              receipt={receiptSummaryForPlan(receipts, plan)}
              onSelectPlan={selectPlan}
              isSplit={isPro && plan.id === splitPlanId}
              {...rowMenuProps}
              isRenaming={renamingPlanId === plan.id}
              renameValue={renamingPlanId === plan.id ? renameValue : undefined}
              onRenameChange={setRenameValue}
              onRenameSubmit={submitRename}
              onRenameCancel={cancelRename}
            />
          )}
        />
      ) : (
        regularPlans.map((plan, index) => {
          const above = regularPlans[index - 1];
          const below = regularPlans[index + 1];
          const row = (
            <PlanRow
              key={plan.id}
              plan={plan}
              selected={plan.id === selectedId}
              unseen={isPro && planState.isUnseen(plan.id, plan.updatedAt)}
              hasSessionSiblings={sessionSiblingIds.has(plan.id)}
              receipt={receiptSummaryForPlan(receipts, plan)}
              onSelectPlan={selectPlan}
              isSplit={isPro && plan.id === splitPlanId}
              {...rowMenuProps}
              isRenaming={renamingPlanId === plan.id}
              renameValue={renamingPlanId === plan.id ? renameValue : undefined}
              onRenameChange={setRenameValue}
              onRenameSubmit={submitRename}
              onRenameCancel={cancelRename}
              onPlanKeyDown={onMovePlan ? movePlanByKey : undefined}
              keyShortcuts={onMovePlan ? MOVE_SHORTCUTS : undefined}
            />
          );
          if (!onMovePlan) return row;
          return (
            <ReorderablePlanRow
              key={plan.id}
              plan={plan}
              above={above}
              below={below}
              onMove={movePlan}
            >
              {row}
            </ReorderablePlanRow>
          );
        })
      )}
      {isPro && contextMenu && (
        <PlanContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          label={`Actions for ${contextMenu.plan.title}`}
          onDismiss={closeContextMenu}
        >
          <MenuButton
            label={contextPlanPinned ? 'Unpin plan' : 'Pin plan'}
            onClick={() => {
              planState.setPinned(contextMenu.plan.id, !contextPlanPinned);
              closeContextMenu();
            }}
          />
          <MenuButton
            label={contextPlanUnseen ? 'Mark as read' : 'Mark as unseen'}
            onClick={() => {
              if (contextPlanUnseen) {
                planState.markSeen(contextMenu.plan.id, contextMenu.plan.updatedAt);
              } else {
                planState.markUnseen(contextMenu.plan.id);
              }
              closeContextMenu();
            }}
          />
          {contextPlanIndex >= 0 && (
            <>
              <MenuButton
                label="Move up"
                disabled={!contextPlanAbove}
                onClick={() => {
                  if (!contextPlanAbove) return;
                  movePlan(contextMenu.plan.id, contextPlanAbove.id, 'row');
                  closeContextMenu();
                }}
              >
                <MoveIcon direction="up" />
              </MenuButton>
              <MenuButton
                label="Move down"
                disabled={!contextPlanBelow}
                onClick={() => {
                  if (!contextPlanBelow) return;
                  movePlan(contextMenu.plan.id, contextPlanBelow.id, 'row');
                  closeContextMenu();
                }}
              >
                <MoveIcon direction="down" />
              </MenuButton>
            </>
          )}
          {folderState && (
            <MenuButton
              label="Move to folder…"
              onClick={() => {
                openMoveToFolderMenu(contextMenu);
              }}
            >
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ flexShrink: 0 }}
              >
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            </MenuButton>
          )}
          {onRenamePlan && (
            <MenuButton
              label="Rename"
              onClick={() => {
                startRename(contextMenu.plan);
                closeContextMenu();
              }}
            />
          )}
          {onOpenInSplitView && (
            <MenuButton
              label="Open in Split View"
              disabled={splitDisabled}
              onClick={() => {
                if (splitDisabled) return;
                planState.markSeen(contextMenu.plan.id, contextMenu.plan.updatedAt);
                onOpenInSplitView(contextMenu.plan);
                closeContextMenu();
              }}
            >
              <svg
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                style={{ width: '14px', height: '14px', flexShrink: 0 }}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 4.5v15m6-15v15M4.5 19.5h15a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5h-15A1.5 1.5 0 0 0 3 6v12a1.5 1.5 0 0 0 1.5 1.5Z"
                />
              </svg>
            </MenuButton>
          )}
          {onDeletePlan && (
            <>
              <div
                role="separator"
                style={{ height: '1px', background: 'var(--border)', margin: '4px 0' }}
              />
              <MenuButton
                label="Delete plan"
                danger
                onClick={() => {
                  if (window.confirm('Delete this plan? This cannot be undone.')) {
                    onDeletePlan(contextMenu.plan.id);
                  }
                  closeContextMenu();
                }}
              >
                <svg
                  aria-hidden="true"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  style={{ width: '14px', height: '14px', flexShrink: 0, color: 'var(--danger)' }}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                  />
                </svg>
              </MenuButton>
            </>
          )}
        </PlanContextMenu>
      )}
      {!isPro && folderState && contextMenu && (
        <PlanContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          label={`Actions for ${contextMenu.plan.title}`}
          onDismiss={closeContextMenu}
        >
          <MenuButton
            label="Move to folder…"
            onClick={() => {
              openMoveToFolderMenu(contextMenu);
            }}
          >
            <svg
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0 }}
            >
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          </MenuButton>
        </PlanContextMenu>
      )}
      {folderState && moveToFolderMenu && (
        <MoveToFolderMenu
          planId={moveToFolderMenu.planId}
          x={Math.min(moveToFolderMenu.x, window.innerWidth - 220)}
          y={Math.min(moveToFolderMenu.y, window.innerHeight - 320)}
          folderState={folderState}
          onClose={closeMoveToFolderMenu}
        />
      )}
    </div>
  );
}
