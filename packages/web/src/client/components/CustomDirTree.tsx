import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Plan } from '../lib/api.ts';
import { buildCustomDirTree, type FsTreeNode } from '../lib/custom-plan-tree.ts';
import { ChevronIcon, FolderIcon } from './PlanTreeIcons.tsx';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function countPlans(node: FsTreeNode): number {
  if (node.type === 'file') return 1;
  return node.children.reduce((sum, child) => sum + countPlans(child), 0);
}

function TrashIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
      aria-hidden="true"
    >
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Source context menu                                               */
/* ------------------------------------------------------------------ */

function SourceContextMenu({
  path,
  x,
  y,
  onClose,
  onRemove,
}: {
  path: string;
  x: number;
  y: number;
  onClose: () => void;
  onRemove: () => void;
}) {
  useEffect(() => {
    function handleClose() {
      onClose();
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
  }, [onClose]);

  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: y,
        left: x,
        zIndex: 50,
        minWidth: '220px',
        maxWidth: '320px',
        padding: '4px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '10px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.04)',
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        style={{
          padding: '6px 12px',
          fontSize: '11px',
          fontFamily: 'monospace',
          color: 'var(--tertiary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={path}
      >
        {path}
      </div>
      <div style={{ height: '1px', background: 'var(--border)', margin: '4px 0' }} />
      <button
        type="button"
        onClick={() => {
          onRemove();
          onClose();
        }}
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
          color: 'var(--danger)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--hover)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <TrashIcon />
        <span>Remove source</span>
      </button>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/*  Directory row                                                     */
/* ------------------------------------------------------------------ */

function DirRow({
  name,
  depth,
  expanded,
  onToggle,
  childCount,
  onContextMenu,
  onRemove,
  removing = false,
}: {
  name: string;
  depth: number;
  expanded: boolean;
  onToggle: () => void;
  childCount: number;
  onContextMenu?: (e: React.MouseEvent) => void;
  onRemove?: () => void;
  removing?: boolean;
}) {
  const row = (
    <button
      type="button"
      onClick={onToggle}
      onContextMenu={onContextMenu}
      className="sidebar-tree-row select-none"
      style={{
        paddingLeft: `${8 + depth * 14}px`,
        paddingRight: onRemove ? '30px' : '8px',
      }}
    >
      <ChevronIcon expanded={expanded} />
      <FolderIcon open={expanded} />
      <span className="sidebar-tree-label">{name}</span>
      {childCount > 0 && <span className="sidebar-count-pill">{childCount}</span>}
    </button>
  );

  if (!onRemove) return row;

  return (
    <div className="sidebar-source-row">
      {row}
      <button
        type="button"
        className="sidebar-source-action"
        disabled={removing}
        aria-label={`Remove ${name} from plan sources`}
        title="Remove source"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        <TrashIcon />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tree node (recursive)                                             */
/* ------------------------------------------------------------------ */

function CustomDirNode({
  node,
  depth,
  expanded,
  onToggle,
  renderPlan,
  onContextMenu,
  onRemove,
  removing,
}: {
  node: FsTreeNode;
  depth: number;
  expanded: Record<string, boolean>;
  onToggle: (key: string) => void;
  renderPlan: (plan: Plan) => React.ReactNode;
  /** Row actions apply to this node only — they are never forwarded to children. */
  onContextMenu?: (e: React.MouseEvent) => void;
  onRemove?: () => void;
  removing?: boolean;
}) {
  if (node.type === 'file') {
    return (
      <div key={node.key} style={{ paddingLeft: `${depth * 14}px` }}>
        {renderPlan(node.plan)}
      </div>
    );
  }

  const isExpanded = expanded[node.key] ?? false;

  return (
    <div>
      <DirRow
        name={node.name}
        depth={depth}
        expanded={isExpanded}
        onToggle={() => onToggle(node.key)}
        childCount={countPlans(node)}
        onContextMenu={onContextMenu}
        onRemove={onRemove}
        removing={removing}
      />
      {isExpanded && (
        <div>
          {node.children.map((child) => (
            <CustomDirNode
              key={child.key}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              renderPlan={renderPlan}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  CustomDirTree (public API)                                        */
/* ------------------------------------------------------------------ */

export function CustomDirTree({
  plans,
  renderPlan,
  onRemoveSource,
  customPlanDirs,
}: {
  plans: Plan[];
  renderPlan: (plan: Plan) => React.ReactNode;
  /** When provided, root source rows expose a remove action (hover button + right click). */
  onRemoveSource?: (dir: string) => void | Promise<void>;
  /** All configured source paths — ensures empty / file-path sources are shown and removable. */
  customPlanDirs?: readonly string[];
}): React.ReactNode {
  const tree = useMemo(() => buildCustomDirTree(plans, customPlanDirs), [plans, customPlanDirs]);
  const rootDirKeys = useMemo(() => {
    const keys: string[] = [];

    for (const node of tree) {
      if (node.type === 'dir') keys.push(node.key);
    }

    return keys;
  }, [tree]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(rootDirKeys.map((key) => [key, true])),
  );
  const [contextMenu, setContextMenu] = useState<{ path: string; x: number; y: number } | null>(
    null,
  );
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setExpanded((prev) => {
      const next = { ...prev };
      let changed = false;

      for (const key of rootDirKeys) {
        if (!(key in next)) {
          next[key] = true;
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [rootDirKeys]);

  const requestRemove = useCallback(
    async (path: string, name: string) => {
      if (!onRemoveSource) return;
      const confirmed = window.confirm(
        `Remove "${name}" from plan sources?\n\n${path}\n\nIts plans stop showing in Agendex. Nothing on disk is deleted.`,
      );
      if (!confirmed) return;

      setRemoving(path);
      setError(null);
      try {
        await onRemoveSource(path);
      } catch (err) {
        setError(err instanceof Error ? err.message : `Failed to remove ${name}`);
      } finally {
        setRemoving(null);
      }
    },
    [onRemoveSource],
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  if (tree.length === 0) return null;

  function toggle(key: string) {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const contextMenuName = contextMenu
    ? (tree.find((node) => node.key === contextMenu.path)?.name ?? contextMenu.path)
    : '';

  return (
    <div>
      <div className="sidebar-section-header">
        <span className="sidebar-section-title">Sources</span>
      </div>
      {error && (
        <div className="sidebar-source-error" role="alert">
          {error}
        </div>
      )}
      {tree.map((node) => {
        const removable = onRemoveSource && node.type === 'dir';

        return (
          <CustomDirNode
            key={node.key}
            node={node}
            depth={0}
            expanded={expanded}
            onToggle={toggle}
            renderPlan={renderPlan}
            onContextMenu={
              removable
                ? (e) => {
                    e.preventDefault();
                    setContextMenu({
                      path: node.key,
                      x: Math.min(e.clientX, window.innerWidth - 240),
                      y: Math.min(e.clientY, window.innerHeight - 120),
                    });
                  }
                : undefined
            }
            onRemove={removable ? () => requestRemove(node.key, node.name) : undefined}
            removing={removing === node.key}
          />
        );
      })}
      {contextMenu && (
        <SourceContextMenu
          path={contextMenu.path}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={closeContextMenu}
          onRemove={() => requestRemove(contextMenu.path, contextMenuName)}
        />
      )}
    </div>
  );
}
