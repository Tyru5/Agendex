import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePlanState } from '../hooks/usePlanState.ts';
import { getAgentLabel } from '../lib/agent-colors.ts';
import type { Plan } from '../lib/api.ts';
import { isCustomDirPlan } from '../lib/custom-plan-tree.ts';
import type { FolderState } from '../lib/plan-folders.ts';
import type { PlanState } from '../lib/plan-state.ts';
import { AgentIcon } from './AgentIcon.tsx';
import { CustomDirTree } from './CustomDirTree.tsx';
import { FolderTree, MoveToFolderMenu } from './FolderTree.tsx';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function PlanRow({
  plan,
  selected,
  unseen,
  onClick,
  isSplit,
  onContextMenu,
  isRenaming,
  renameValue,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
}: {
  plan: Plan;
  selected: boolean;
  unseen: boolean;
  onClick: () => void;
  isSplit?: boolean;
  onContextMenu?: (e: React.MouseEvent) => void;
  isRenaming?: boolean;
  renameValue?: string;
  onRenameChange?: (value: string) => void;
  onRenameSubmit?: () => void;
  onRenameCancel?: () => void;
}) {
  const titleRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    setOverflows(el.scrollWidth > el.clientWidth);
  });

  useEffect(() => {
    if (isRenaming) renameInputRef.current?.focus();
  }, [isRenaming]);

  return (
    <button
      type="button"
      onClick={isRenaming ? undefined : onClick}
      onContextMenu={onContextMenu}
      className={`w-full text-left block plan-row sidebar-plan-row${selected ? ' plan-row--selected' : ''}${isSplit ? ' plan-row--split' : ''} cursor-pointer font-[inherit]`}
      style={{
        background: selected ? 'var(--active)' : isSplit ? 'var(--hover)' : 'transparent',
        border: isSplit ? '1px dashed var(--border)' : undefined,
      }}
    >
      {isRenaming ? (
        <input
          ref={renameInputRef}
          type="text"
          value={renameValue ?? ''}
          onChange={(e) => onRenameChange?.(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') onRenameSubmit?.();
            if (e.key === 'Escape') onRenameCancel?.();
          }}
          onBlur={() => onRenameCancel?.()}
          onClick={(e) => e.stopPropagation()}
          className="w-full text-[13px] font-medium font-[inherit] bg-transparent border border-border rounded-[5px] px-1.5 py-0.5 outline-none text-text"
          style={{ lineHeight: '1.35' }}
        />
      ) : (
        <div
          ref={titleRef}
          className={`plan-title${overflows ? ' plan-title--fade' : ''}`}
          style={{ paddingLeft: unseen ? '14px' : undefined }}
        >
          {unseen && <span className="sidebar-unread-dot" />}
          {plan.title}
        </div>
      )}
      <div className="sidebar-plan-meta">
        <AgentIcon agent={plan.agent} size={10} />
        <span className="sidebar-plan-meta-label">{getAgentLabel(plan.agent)}</span>
        <span aria-hidden="true">·</span>
        <span>{timeAgo(plan.updatedAt)}</span>
      </div>
    </button>
  );
}

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
      disabled={disabled}
      onClick={onClick}
      style={{
        width: '100%',
        textAlign: 'left',
        padding: '8px 12px',
        fontSize: '13px',
        fontWeight: 450,
        fontFamily: 'inherit',
        borderRadius: '7px',
        border: 'none',
        background: 'transparent',
        color: disabled ? 'var(--tertiary)' : danger ? '#ef4444' : 'var(--text)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = 'var(--hover)';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

type PlanListProps = {
  plans: Plan[];
  selectedId: string | undefined;
  onSelect: (plan: Plan) => void;
  isPro?: boolean;
  splitPlanId?: string;
  onOpenInSplitView?: (plan: Plan) => void;
  planState?: PlanState;
  onRenamePlan?: (planId: string, newTitle: string) => void;
  onDeletePlan?: (planId: string) => void;
  folderState?: FolderState;
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
    folderState,
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

  useEffect(() => {
    if (!contextMenu) return;
    function handleClose() {
      setContextMenu(null);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose();
    }
    window.addEventListener('pointerdown', handleClose);
    window.addEventListener('scroll', handleClose, true);
    window.addEventListener('resize', handleClose);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handleClose);
      window.removeEventListener('scroll', handleClose, true);
      window.removeEventListener('resize', handleClose);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

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

  const { customDirPlans, nonCustomPlans } = useMemo(() => {
    const custom: Plan[] = [];
    const regular: Plan[] = [];
    for (const plan of plans) {
      if (isCustomDirPlan(plan)) {
        custom.push(plan);
      } else {
        regular.push(plan);
      }
    }
    return { customDirPlans: custom, nonCustomPlans: regular };
  }, [plans]);

  const { pinnedPlans, unseenPlans, regularPlans } = useMemo(() => {
    if (!isPro) return { pinnedPlans: [], unseenPlans: [], regularPlans: nonCustomPlans };

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
  }, [nonCustomPlans, planState, selectedId, isPro]);

  function handleClick(plan: Plan) {
    if (isPro) planState.markSeen(plan.id, plan.updatedAt);
    onSelect(plan);
  }

  function handleContextMenu(e: React.MouseEvent, plan: Plan) {
    if (!isPro && !folderState) return;
    e.preventDefault();
    const x = Math.min(e.clientX, window.innerWidth - 220);
    const y = Math.min(e.clientY, window.innerHeight - 120);
    setContextMenu({ plan, x, y });
  }

  const startRename = useCallback((plan: Plan) => {
    setRenamingPlanId(plan.id);
    setRenameValue(plan.title);
  }, []);

  const cancelRename = useCallback(() => {
    setRenamingPlanId(null);
    setRenameValue('');
  }, []);

  const submitRename = useCallback(() => {
    const trimmed = renameValue.trim();
    if (renamingPlanId && trimmed && onRenamePlan) {
      onRenamePlan(renamingPlanId, trimmed);
    }
    setRenamingPlanId(null);
    setRenameValue('');
  }, [renamingPlanId, renameValue, onRenamePlan]);

  if (plans.length === 0) {
    return <div className="sidebar-empty-state">No plans found</div>;
  }

  const contextPlan = contextMenu?.plan;
  const contextPlanPinned = contextPlan ? planState.isPinned(contextPlan.id) : false;
  const contextPlanUnseen = contextPlan
    ? planState.isUnseen(contextPlan.id, contextPlan.updatedAt)
    : false;
  const splitDisabled = contextPlan ? contextPlan.id === selectedId : false;

  return (
    <div className="w-full">
      {customDirPlans.length > 0 && (
        <>
          <CustomDirTree
            plans={customDirPlans}
            renderPlan={(plan) => (
              <PlanRow
                key={plan.id}
                plan={plan}
                selected={plan.id === selectedId}
                unseen={isPro && planState.isUnseen(plan.id, plan.updatedAt)}
                onClick={() => handleClick(plan)}
                isSplit={isPro && plan.id === splitPlanId}
                onContextMenu={(e) => handleContextMenu(e, plan)}
                isRenaming={renamingPlanId === plan.id}
                renameValue={renameValue}
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
              onClick={() => handleClick(plan)}
              isSplit={plan.id === splitPlanId}
              onContextMenu={(e) => handleContextMenu(e, plan)}
              isRenaming={renamingPlanId === plan.id}
              renameValue={renameValue}
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
              onClick={() => handleClick(plan)}
              isSplit={plan.id === splitPlanId}
              onContextMenu={(e) => handleContextMenu(e, plan)}
              isRenaming={renamingPlanId === plan.id}
              renameValue={renameValue}
              onRenameChange={setRenameValue}
              onRenameSubmit={submitRename}
              onRenameCancel={cancelRename}
            />
          ))}
          {regularPlans.length > 0 && <div className="sidebar-ghost-divider" />}
        </div>
      )}
      {folderState && folderState.folders.length > 0 ? (
        <FolderTree
          folderState={folderState}
          plans={regularPlans}
          renderPlan={(plan) => (
            <PlanRow
              key={plan.id}
              plan={plan}
              selected={plan.id === selectedId}
              unseen={isPro && planState.isUnseen(plan.id, plan.updatedAt)}
              onClick={() => handleClick(plan)}
              isSplit={isPro && plan.id === splitPlanId}
              onContextMenu={(e) => handleContextMenu(e, plan)}
              isRenaming={renamingPlanId === plan.id}
              renameValue={renameValue}
              onRenameChange={setRenameValue}
              onRenameSubmit={submitRename}
              onRenameCancel={cancelRename}
            />
          )}
        />
      ) : (
        regularPlans.map((plan) => (
          <PlanRow
            key={plan.id}
            plan={plan}
            selected={plan.id === selectedId}
            unseen={isPro && planState.isUnseen(plan.id, plan.updatedAt)}
            onClick={() => handleClick(plan)}
            isSplit={isPro && plan.id === splitPlanId}
            onContextMenu={isPro || folderState ? (e) => handleContextMenu(e, plan) : undefined}
            isRenaming={renamingPlanId === plan.id}
            renameValue={renameValue}
            onRenameChange={setRenameValue}
            onRenameSubmit={submitRename}
            onRenameCancel={cancelRename}
          />
        ))
      )}
      {isPro &&
        contextMenu &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              top: contextMenu.y,
              left: contextMenu.x,
              zIndex: 50,
              minWidth: '196px',
              padding: '4px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '10px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.04)',
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <MenuButton
              label={contextPlanPinned ? 'Unpin plan' : 'Pin plan'}
              onClick={() => {
                planState.setPinned(contextMenu.plan.id, !contextPlanPinned);
                setContextMenu(null);
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
                setContextMenu(null);
              }}
            />
            {folderState && (
              <MenuButton
                label="Move to folder…"
                onClick={() => {
                  setMoveToFolderMenu({
                    planId: contextMenu.plan.id,
                    x: contextMenu.x + 196,
                    y: contextMenu.y,
                  });
                  setContextMenu(null);
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
                  setContextMenu(null);
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
                  setContextMenu(null);
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
                <div style={{ height: '1px', background: 'var(--border)', margin: '4px 0' }} />
                <MenuButton
                  label="Delete plan"
                  danger
                  onClick={() => {
                    if (window.confirm('Delete this plan? This cannot be undone.')) {
                      onDeletePlan(contextMenu.plan.id);
                    }
                    setContextMenu(null);
                  }}
                >
                  <svg
                    aria-hidden="true"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    style={{ width: '14px', height: '14px', flexShrink: 0, color: '#ef4444' }}
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
          </div>,
          document.body,
        )}
      {!isPro &&
        folderState &&
        contextMenu &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              top: contextMenu.y,
              left: contextMenu.x,
              zIndex: 50,
              minWidth: '196px',
              padding: '4px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '10px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.04)',
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <MenuButton
              label="Move to folder…"
              onClick={() => {
                setMoveToFolderMenu({
                  planId: contextMenu.plan.id,
                  x: contextMenu.x + 196,
                  y: contextMenu.y,
                });
                setContextMenu(null);
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
          </div>,
          document.body,
        )}
      {folderState && moveToFolderMenu && (
        <MoveToFolderMenu
          planId={moveToFolderMenu.planId}
          x={Math.min(moveToFolderMenu.x, window.innerWidth - 220)}
          y={Math.min(moveToFolderMenu.y, window.innerHeight - 320)}
          folderState={folderState}
          onClose={() => setMoveToFolderMenu(null)}
        />
      )}
    </div>
  );
}
