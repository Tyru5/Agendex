import { useState } from 'react';
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

/* ------------------------------------------------------------------ */
/*  Directory row                                                     */
/* ------------------------------------------------------------------ */

function DirRow({
  name,
  depth,
  expanded,
  onToggle,
  childCount,
}: {
  name: string;
  depth: number;
  expanded: boolean;
  onToggle: () => void;
  childCount: number;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-1.5 py-1.5 rounded-[7px] cursor-pointer select-none border-none bg-transparent font-[inherit] text-left"
      style={{
        paddingLeft: `${8 + depth * 14}px`,
        paddingRight: '8px',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--hover)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      <ChevronIcon expanded={expanded} />
      <FolderIcon open={expanded} />
      <span className="text-[12.5px] font-medium text-text truncate flex-1">{name}</span>
      {childCount > 0 && (
        <span className="text-[10.5px] text-tertiary tabular-nums">{childCount}</span>
      )}
    </button>
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
}: {
  node: FsTreeNode;
  depth: number;
  expanded: Record<string, boolean>;
  onToggle: (key: string) => void;
  renderPlan: (plan: Plan) => React.ReactNode;
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
}: {
  plans: Plan[];
  renderPlan: (plan: Plan) => React.ReactNode;
}): React.ReactNode {
  const tree = buildCustomDirTree(plans);

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const node of tree) {
      if (node.type === 'dir') {
        init[node.key] = true;
      }
    }
    return init;
  });

  if (tree.length === 0) return null;

  function toggle(key: string) {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div>
      <div className="flex items-center justify-between px-2 pt-2 pb-1">
        <span className="text-[11px] font-semibold text-tertiary tracking-[0.04em] uppercase">
          Sources
        </span>
      </div>
      {tree.map((node) => (
        <CustomDirNode
          key={node.key}
          node={node}
          depth={0}
          expanded={expanded}
          onToggle={toggle}
          renderPlan={renderPlan}
        />
      ))}
    </div>
  );
}
