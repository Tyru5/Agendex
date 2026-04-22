import { useState } from 'react';
import type { Plan } from '../lib/api.ts';
import { buildCustomDirTree, type FsTreeNode } from '../lib/custom-plan-tree.ts';

/* ------------------------------------------------------------------ */
/*  Inline SVG icons                                                  */
/* ------------------------------------------------------------------ */

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        transition: 'transform 120ms ease',
        transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
        flexShrink: 0,
      }}
      aria-hidden="true"
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
      aria-hidden="true"
    >
      {open ? (
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v2M2 10l3.09 8.26A2 2 0 0 0 7 20h12.36a1 1 0 0 0 .96-.73L23 10H2z" />
      ) : (
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      )}
    </svg>
  );
}

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
