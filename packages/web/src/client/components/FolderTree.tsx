import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Plan } from '../lib/api.ts';
import type { FolderState, PlanFolder } from '../lib/plan-folders.ts';
import { getChildFolders, getRootFolders, MAX_FOLDERS } from '../lib/plan-folders.ts';
import { ChevronIcon, FolderIcon } from './PlanTreeIcons.tsx';

/* ------------------------------------------------------------------ */
/*  Folder context menu                                               */
/* ------------------------------------------------------------------ */

function FolderContextMenu({
  folder,
  x,
  y,
  folderState,
  onClose,
  onStartRename,
}: {
  folder: PlanFolder;
  x: number;
  y: number;
  folderState: FolderState;
  onClose: () => void;
  onStartRename: (folderId: string) => void;
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

  const atLimit = folderState.folderCount >= MAX_FOLDERS;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: y,
        left: x,
        zIndex: 50,
        minWidth: '180px',
        padding: '4px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '10px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.04)',
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        disabled={atLimit}
        onClick={() => {
          folderState.createFolder('New folder', folder.id);
          folderState.setExpanded(folder.id, true);
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
          color: atLimit ? 'var(--tertiary)' : 'var(--text)',
          cursor: atLimit ? 'not-allowed' : 'pointer',
        }}
        onMouseEnter={(e) => {
          if (!atLimit) e.currentTarget.style.background = 'var(--hover)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        New subfolder
      </button>
      <button
        type="button"
        onClick={() => {
          onStartRename(folder.id);
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
          color: 'var(--text)',
          cursor: 'pointer',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--hover)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        Rename
      </button>
      <div style={{ height: '1px', background: 'var(--border)', margin: '4px 0' }} />
      <button
        type="button"
        onClick={() => {
          if (
            window.confirm(`Delete "${folder.name}" and all subfolders? Plans will be unassigned.`)
          ) {
            folderState.deleteFolder(folder.id);
          }
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
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--hover)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        Delete folder
      </button>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/*  Move to folder menu                                               */
/* ------------------------------------------------------------------ */

export function MoveToFolderMenu({
  planId,
  x,
  y,
  folderState,
  onClose,
}: {
  planId: string;
  x: number;
  y: number;
  folderState: FolderState;
  onClose: () => void;
}) {
  const currentFolderId = folderState.getFolderForPlan(planId);

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

  function renderFolders(parentId: string | null, depth: number): React.ReactNode[] {
    const children =
      parentId === null
        ? getRootFolders(Object.fromEntries(folderState.folders.map((f) => [f.id, f])))
        : getChildFolders(parentId, Object.fromEntries(folderState.folders.map((f) => [f.id, f])));

    return children.flatMap((folder) => [
      <button
        type="button"
        key={folder.id}
        onClick={() => {
          folderState.assignPlan(planId, folder.id);
          folderState.expandPathTo(folder.id);
          onClose();
        }}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '6px 12px',
          paddingLeft: `${12 + depth * 16}px`,
          fontSize: '13px',
          fontWeight: currentFolderId === folder.id ? 600 : 450,
          fontFamily: 'inherit',
          borderRadius: '7px',
          border: 'none',
          background: 'transparent',
          color: currentFolderId === folder.id ? 'var(--accent)' : 'var(--text)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--hover)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <FolderIcon open={false} />
        <span className="truncate">{folder.name}</span>
        {currentFolderId === folder.id && (
          <span style={{ marginLeft: 'auto', fontSize: '11px' }}>✓</span>
        )}
      </button>,
      ...renderFolders(folder.id, depth + 1),
    ]);
  }

  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: y,
        left: x,
        zIndex: 210,
        minWidth: '200px',
        maxHeight: '300px',
        overflow: 'auto',
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
          fontWeight: 600,
          color: 'var(--tertiary)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        Move to folder
      </div>
      {currentFolderId && (
        <button
          type="button"
          onClick={() => {
            folderState.assignPlan(planId, null);
            onClose();
          }}
          style={{
            width: '100%',
            textAlign: 'left',
            padding: '6px 12px',
            fontSize: '13px',
            fontWeight: 450,
            fontFamily: 'inherit',
            borderRadius: '7px',
            border: 'none',
            background: 'transparent',
            color: 'var(--secondary)',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--hover)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          ✕ Remove from folder
        </button>
      )}
      {folderState.folders.length === 0 ? (
        <div
          style={{
            padding: '12px',
            fontSize: '12px',
            color: 'var(--tertiary)',
            textAlign: 'center',
          }}
        >
          No folders yet
        </div>
      ) : (
        renderFolders(null, 0)
      )}
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/*  Folder row                                                        */
/* ------------------------------------------------------------------ */

function FolderRow({
  folder,
  depth,
  expanded,
  onToggle,
  onContextMenu,
  isRenaming,
  renameValue,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  childCount,
}: {
  folder: PlanFolder;
  depth: number;
  expanded: boolean;
  onToggle: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  isRenaming: boolean;
  renameValue: string;
  onRenameChange: (v: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  childCount: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming) inputRef.current?.focus();
  }, [isRenaming]);

  return (
    <button
      type="button"
      onClick={isRenaming ? undefined : onToggle}
      onContextMenu={onContextMenu}
      className="sidebar-tree-row select-none"
      style={{
        paddingLeft: `${8 + depth * 14}px`,
        paddingRight: '8px',
      }}
    >
      <ChevronIcon expanded={expanded} />
      <FolderIcon open={expanded} />
      {isRenaming ? (
        <input
          ref={inputRef}
          type="text"
          value={renameValue}
          onChange={(e) => onRenameChange(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') onRenameSubmit();
            if (e.key === 'Escape') onRenameCancel();
          }}
          onBlur={() => onRenameCancel()}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 text-[12.5px] font-medium font-[inherit] bg-transparent border border-border rounded-[5px] px-1.5 py-0.5 outline-none text-text min-w-0"
        />
      ) : (
        <>
          <span className="sidebar-tree-label">{folder.name}</span>
          {childCount > 0 && <span className="sidebar-count-pill">{childCount}</span>}
        </>
      )}
    </button>
  );
}

function countPlansInSubtree(
  folderId: string,
  plansByFolder: Map<string, Plan[]>,
  allFolders: Record<string, PlanFolder>,
): number {
  const ownPlans = plansByFolder.get(folderId)?.length ?? 0;
  const children = getChildFolders(folderId, allFolders);
  return (
    ownPlans +
    children.reduce(
      (sum, child) => sum + countPlansInSubtree(child.id, plansByFolder, allFolders),
      0,
    )
  );
}

/* ------------------------------------------------------------------ */
/*  Folder tree node (recursive)                                      */
/* ------------------------------------------------------------------ */

function FolderTreeNode({
  folder,
  depth,
  folderState,
  allFolders,
  plansByFolder,
  renderPlan,
  renamingFolderId,
  renameValue,
  onStartRename,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  contextMenu,
  setContextMenu,
}: {
  folder: PlanFolder;
  depth: number;
  folderState: FolderState;
  allFolders: Record<string, PlanFolder>;
  plansByFolder: Map<string, Plan[]>;
  renderPlan: (plan: Plan) => React.ReactNode;
  renamingFolderId: string | null;
  renameValue: string;
  onStartRename: (folderId: string) => void;
  onRenameChange: (v: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  contextMenu: { folder: PlanFolder; x: number; y: number } | null;
  setContextMenu: (m: { folder: PlanFolder; x: number; y: number } | null) => void;
}) {
  const expanded = folderState.isExpanded(folder.id);
  const children = getChildFolders(folder.id, allFolders);
  const plans = plansByFolder.get(folder.id) ?? [];
  const totalPlans = countPlansInSubtree(folder.id, plansByFolder, allFolders);

  return (
    <div>
      <FolderRow
        folder={folder}
        depth={depth}
        expanded={expanded}
        onToggle={() => folderState.setExpanded(folder.id, !expanded)}
        onContextMenu={(e) => {
          e.preventDefault();
          const x = Math.min(e.clientX, window.innerWidth - 200);
          const y = Math.min(e.clientY, window.innerHeight - 150);
          setContextMenu({ folder, x, y });
        }}
        isRenaming={renamingFolderId === folder.id}
        renameValue={renameValue}
        onRenameChange={onRenameChange}
        onRenameSubmit={onRenameSubmit}
        onRenameCancel={onRenameCancel}
        childCount={totalPlans}
      />
      {expanded && (
        <div>
          {children.map((child) => (
            <FolderTreeNode
              key={child.id}
              folder={child}
              depth={depth + 1}
              folderState={folderState}
              allFolders={allFolders}
              plansByFolder={plansByFolder}
              renderPlan={renderPlan}
              renamingFolderId={renamingFolderId}
              renameValue={renameValue}
              onStartRename={onStartRename}
              onRenameChange={onRenameChange}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
              contextMenu={contextMenu}
              setContextMenu={setContextMenu}
            />
          ))}
          {plans.map((plan) => (
            <div key={plan.id} style={{ paddingLeft: `${(depth + 1) * 14}px` }}>
              {renderPlan(plan)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  FolderTree (public API)                                           */
/* ------------------------------------------------------------------ */

export function FolderTree({
  folderState,
  plans,
  renderPlan,
}: {
  folderState: FolderState;
  plans: Plan[];
  renderPlan: (plan: Plan) => React.ReactNode;
}) {
  const [contextMenu, setContextMenu] = useState<{
    folder: PlanFolder;
    x: number;
    y: number;
  } | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const allFolders = Object.fromEntries(folderState.folders.map((f) => [f.id, f]));

  const plansByFolder = new Map<string, Plan[]>();
  const unassigned: Plan[] = [];

  for (const plan of plans) {
    const folderId = folderState.getFolderForPlan(plan.id);
    if (folderId) {
      const arr = plansByFolder.get(folderId);
      if (arr) arr.push(plan);
      else plansByFolder.set(folderId, [plan]);
    } else {
      unassigned.push(plan);
    }
  }

  const rootFolders = getRootFolders(allFolders);
  const atLimit = folderState.folderCount >= MAX_FOLDERS;

  const startRename = useCallback(
    (folderId: string) => {
      const folder = allFolders[folderId];
      if (!folder) return;
      setRenamingFolderId(folderId);
      setRenameValue(folder.name);
    },
    [allFolders],
  );

  const cancelRename = useCallback(() => {
    setRenamingFolderId(null);
    setRenameValue('');
  }, []);

  const submitRename = useCallback(() => {
    if (renamingFolderId) {
      folderState.renameFolder(renamingFolderId, renameValue);
    }
    setRenamingFolderId(null);
    setRenameValue('');
  }, [renamingFolderId, renameValue, folderState]);

  return (
    <div>
      {/* Folder header with add button */}
      {(rootFolders.length > 0 || folderState.folderCount > 0) && (
        <div className="sidebar-section-header">
          <span className="sidebar-section-title">Folders</span>
          <div className="flex items-center gap-2">
            <span className="sidebar-count-pill">
              {folderState.folderCount}/{MAX_FOLDERS}
            </span>
            <button
              type="button"
              disabled={atLimit}
              onClick={() => folderState.createFolder('New folder')}
              className="sidebar-section-action"
              style={{ opacity: atLimit ? 0.4 : 1, cursor: atLimit ? 'not-allowed' : 'pointer' }}
              title={atLimit ? 'Folder limit reached' : 'New folder'}
            >
              + New
            </button>
          </div>
        </div>
      )}

      {/* Folder tree */}
      {rootFolders.map((folder) => (
        <FolderTreeNode
          key={folder.id}
          folder={folder}
          depth={0}
          folderState={folderState}
          allFolders={allFolders}
          plansByFolder={plansByFolder}
          renderPlan={renderPlan}
          renamingFolderId={renamingFolderId}
          renameValue={renameValue}
          onStartRename={startRename}
          onRenameChange={setRenameValue}
          onRenameSubmit={submitRename}
          onRenameCancel={cancelRename}
          contextMenu={contextMenu}
          setContextMenu={setContextMenu}
        />
      ))}

      {/* Unassigned plans */}
      {rootFolders.length > 0 && unassigned.length > 0 && <div className="sidebar-ghost-divider" />}
      {unassigned.map((plan) => renderPlan(plan))}

      {/* Context menu */}
      {contextMenu && (
        <FolderContextMenu
          folder={contextMenu.folder}
          x={contextMenu.x}
          y={contextMenu.y}
          folderState={folderState}
          onClose={() => setContextMenu(null)}
          onStartRename={startRename}
        />
      )}
    </div>
  );
}
