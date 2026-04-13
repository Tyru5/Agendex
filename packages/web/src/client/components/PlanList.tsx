import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePlanState } from '../hooks/usePlanState.ts';
import { getAgentLabel } from '../lib/agent-colors.ts';
import type { Plan } from '../lib/api.ts';
import type { PlanState } from '../lib/plan-state.ts';
import { AgentIcon } from './AgentIcon.tsx';

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
      className={`w-full text-left block plan-row${selected ? ' plan-row--selected' : ''}${isSplit ? ' plan-row--split' : ''} py-2.5 px-2 rounded-[7px] cursor-pointer border-none font-[inherit]`}
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
          {unseen && (
            <span className="unseen-dot absolute left-0.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[#3b82f6]" />
          )}
          {plan.title}
        </div>
      )}
      <div className="flex items-center gap-1.5 mt-1 text-[11.5px] text-tertiary">
        <AgentIcon agent={plan.agent} size={11} />
        <span>{getAgentLabel(plan.agent)}</span>
        <span>&middot;</span>
        <span>{timeAgo(plan.updatedAt)}</span>
      </div>
    </button>
  );
}

function MenuButton({
  label,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
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
        color: disabled ? 'var(--tertiary)' : 'var(--text)',
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
  } = props;
  const localPlanState = usePlanState();
  const planState = planStateProp ?? localPlanState;
  const [contextMenu, setContextMenu] = useState<{ plan: Plan; x: number; y: number } | null>(null);
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

  const { pinnedPlans, unseenPlans, restPlans } = useMemo(() => {
    if (!isPro) return { pinnedPlans: [], unseenPlans: [], restPlans: plans };

    const pinned: Plan[] = [];
    const unseen: Plan[] = [];
    const rest: Plan[] = [];

    for (const plan of plans) {
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

    return { pinnedPlans: pinned, unseenPlans: unseen, restPlans: rest };
  }, [plans, planState, selectedId, isPro]);

  function handleClick(plan: Plan) {
    if (isPro) planState.markSeen(plan.id, plan.updatedAt);
    onSelect(plan);
  }

  function handleContextMenu(e: React.MouseEvent, plan: Plan) {
    if (!isPro) return;
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
    return <div className="p-4 text-[13px] text-tertiary">No plans found</div>;
  }

  const contextPlan = contextMenu?.plan;
  const contextPlanPinned = contextPlan ? planState.isPinned(contextPlan.id) : false;
  const contextPlanUnseen = contextPlan
    ? planState.isUnseen(contextPlan.id, contextPlan.updatedAt)
    : false;
  const splitDisabled = contextPlan ? contextPlan.id === selectedId : false;

  return (
    <div className="w-full">
      {pinnedPlans.length > 0 && (
        <div className="mb-2">
          <div className="px-2 pt-1.5 pb-1 w-full text-[11px] font-semibold text-tertiary tracking-[0.04em] uppercase">
            Pinned ({pinnedPlans.length})
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
          {(unseenPlans.length > 0 || restPlans.length > 0) && (
            <div className="h-px bg-border mx-2 my-1.5" />
          )}
        </div>
      )}
      {unseenPlans.length > 0 && (
        <div className="mb-2">
          <div className="flex items-center justify-between px-2 pt-1.5 pb-1 w-full">
            <span className="text-[11px] font-semibold text-[#3b82f6] tracking-[0.04em] uppercase">
              Updated ({unseenPlans.length})
            </span>
            <button
              type="button"
              onClick={() => planState.markAllSeen(unseenPlans)}
              className="text-[11px] text-tertiary bg-none border-none cursor-pointer p-0 font-[inherit] whitespace-nowrap"
            >
              Mark all read
            </button>
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
          {restPlans.length > 0 && <div className="h-px bg-border mx-2 my-1.5" />}
        </div>
      )}
      {restPlans.map((plan) => (
        <PlanRow
          key={plan.id}
          plan={plan}
          selected={plan.id === selectedId}
          unseen={isPro && planState.isUnseen(plan.id, plan.updatedAt)}
          onClick={() => handleClick(plan)}
          isSplit={isPro && plan.id === splitPlanId}
          onContextMenu={isPro ? (e) => handleContextMenu(e, plan) : undefined}
          isRenaming={renamingPlanId === plan.id}
          renameValue={renameValue}
          onRenameChange={setRenameValue}
          onRenameSubmit={submitRename}
          onRenameCancel={cancelRename}
        />
      ))}
      {isPro &&
        contextMenu &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              top: contextMenu.y,
              left: contextMenu.x,
              zIndex: 200,
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
          </div>,
          document.body,
        )}
    </div>
  );
}
