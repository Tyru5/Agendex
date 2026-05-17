import { useEffect, useMemo, useState } from 'react';
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
      className="sidebar-tree-row select-none"
      style={{
        paddingLeft: `${8 + depth * 14}px`,
        paddingRight: '8px',
      }}
    >
      <ChevronIcon expanded={expanded} />
      <FolderIcon open={expanded} />
      <span className="sidebar-tree-label">{name}</span>
      {childCount > 0 && <span className="sidebar-count-pill">{childCount}</span>}
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
  const tree = useMemo(() => buildCustomDirTree(plans), [plans]);
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

  if (tree.length === 0) return null;

  function toggle(key: string) {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div>
      <div className="sidebar-section-header">
        <span className="sidebar-section-title">Sources</span>
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
