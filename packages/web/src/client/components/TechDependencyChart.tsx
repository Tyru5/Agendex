import { Background, Controls, Handle, MiniMap, Position, ReactFlow } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import '@xyflow/react/dist/style.css';
import type { NodeProps } from '@xyflow/react';
import type { Plan } from '../lib/api.ts';
import { normalizePlanMarkdown } from '../lib/plan-markdown.ts';
import type { TechCategory } from '../lib/tech-extract.ts';
import { extractTechnologies } from '../lib/tech-extract.ts';
import {
  buildAdjacencyMap,
  buildTechGraph,
  CATEGORY_COLORS,
  type TechEdge,
  type TechGraph,
  type TechNode,
  type TechNodeData,
} from '../lib/tech-graph.ts';

// ─── Node Component ───

function TechNodeComponent({ data }: NodeProps<TechNode>) {
  const color = CATEGORY_COLORS[data.category] ?? '#64748b';
  const mentionCount = data.mentionCount ?? 1;

  return (
    <div
      className="rounded-lg px-3.5 py-2 min-w-[100px] relative transition-opacity duration-150"
      style={{
        background: `${color}18`,
        borderLeft: `3px solid ${color}`,
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!w-1.5 !h-1.5 !border-none"
        style={{ background: color }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-1.5 !h-1.5 !border-none"
        style={{ background: color }}
      />
      <div className="flex items-center gap-1.5">
        <span className="text-[13px] text-text leading-[1.3]" style={{ fontWeight: 550 }}>
          {data.label}
        </span>
        {mentionCount > 1 && (
          <span
            className="text-[10px] font-semibold px-[5px] py-px rounded-[6px] leading-[1.4]"
            style={{ background: `${color}30`, color }}
          >
            {mentionCount}
          </span>
        )}
      </div>
      <div className="text-[10px] opacity-60 uppercase tracking-[0.03em] mt-0.5 text-text">
        {data.category}
      </div>
    </div>
  );
}

// ─── Category Filter Pills ───

function CategoryFilters({
  graph,
  activeCategories,
  onToggle,
}: {
  graph: TechGraph;
  activeCategories: Set<TechCategory>;
  onToggle: (cat: TechCategory) => void;
}) {
  const categoryCounts = useMemo(() => {
    const counts = new Map<TechCategory, number>();
    for (const n of graph.nodes) {
      counts.set(n.data.category, (counts.get(n.data.category) ?? 0) + 1);
    }
    return counts;
  }, [graph.nodes]);

  const presentCategories = useMemo(
    () =>
      (Object.keys(CATEGORY_COLORS) as TechCategory[]).filter(
        (cat) => (categoryCounts.get(cat) ?? 0) > 0,
      ),
    [categoryCounts],
  );

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      <span className="text-[11px] text-tertiary mr-0.5">Filter:</span>
      {presentCategories.map((cat) => {
        const color = CATEGORY_COLORS[cat];
        const active = activeCategories.has(cat);
        const count = categoryCounts.get(cat) ?? 0;
        return (
          <button
            type="button"
            key={cat}
            onClick={() => onToggle(cat)}
            className="flex items-center gap-[5px] px-2.5 py-[3px] text-[11px] font-medium font-inherit rounded-[6px] cursor-pointer transition-all duration-150 capitalize"
            style={{
              border: `1px solid ${active ? `${color}40` : 'var(--border)'}`,
              background: active ? `${color}15` : 'transparent',
              color: active ? color : 'var(--tertiary)',
              opacity: active ? 1 : 0.6,
            }}
          >
            <div
              className="w-[7px] h-[7px] rounded-full shrink-0"
              style={{ background: active ? color : 'var(--tertiary)' }}
            />
            {cat}
            <span className="opacity-60">({count})</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Icons ───

function FullscreenIcon() {
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
        d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"
      />
    </svg>
  );
}

function ExpandWidthIcon() {
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
        d="M3.75 12h16.5m-16.5 0 4.5 4.5m-4.5-4.5 4.5-4.5m12 9-4.5-4.5m4.5 4.5-4.5 4.5"
      />
    </svg>
  );
}

function CollapseWidthIcon() {
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
        d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M15 15h4.5M15 15v4.5m0-4.5 5.25 5.25"
      />
    </svg>
  );
}

function ExitFullscreenIcon() {
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
        d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5 5.25 5.25"
      />
    </svg>
  );
}

// ─── Graph Rendering ───

function GraphContent({
  nodes,
  edges,
  nodeTypes,
  focusedNodeId,
  adjacencyMap,
  onNodeHover,
  onNodeLeave,
}: {
  nodes: TechNode[];
  edges: TechEdge[];
  nodeTypes: Record<string, React.ComponentType<NodeProps<TechNode>>>;
  focusedNodeId: string | null;
  adjacencyMap: Map<string, Set<string>>;
  onNodeHover: (id: string) => void;
  onNodeLeave: () => void;
}) {
  // Apply focus dimming
  const styledNodes = useMemo(() => {
    if (!focusedNodeId) return nodes;
    const neighbors = adjacencyMap.get(focusedNodeId) ?? new Set();
    return nodes.map((n) => {
      const isHighlighted = n.id === focusedNodeId || neighbors.has(n.id);
      return {
        ...n,
        style: { ...n.style, opacity: isHighlighted ? 1 : 0.15, transition: 'opacity 0.15s' },
      };
    });
  }, [nodes, focusedNodeId, adjacencyMap]);

  const styledEdges = useMemo(() => {
    if (!focusedNodeId) return edges;
    const neighbors = adjacencyMap.get(focusedNodeId) ?? new Set();
    return edges.map((e) => {
      const isConnected =
        e.source === focusedNodeId ||
        e.target === focusedNodeId ||
        (neighbors.has(e.source) && neighbors.has(e.target));
      return {
        ...e,
        style: {
          ...e.style,
          opacity: isConnected ? 0.8 : 0.04,
          strokeWidth: isConnected ? 2 : (e.style?.strokeWidth ?? 1),
          transition: 'opacity 0.15s, stroke-width 0.15s',
        },
      };
    });
  }, [edges, focusedNodeId, adjacencyMap]);

  return (
    <ReactFlow
      nodes={styledNodes}
      edges={styledEdges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.3 }}
      minZoom={0.2}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      nodesDraggable={true}
      nodesConnectable={false}
      elementsSelectable={true}
      onlyRenderVisibleElements={true}
      onNodeMouseEnter={(_e, node) => onNodeHover(node.id)}
      onNodeMouseLeave={onNodeLeave}
      defaultEdgeOptions={{
        type: 'smoothstep',
        style: { stroke: 'rgba(148,163,184,0.35)', strokeWidth: 1.5 },
      }}
    >
      <Background gap={20} size={1} color="rgba(148,163,184,0.08)" />
      <Controls
        showInteractive={false}
        style={{
          borderRadius: '8px',
          border: '1px solid var(--border)',
          background: 'var(--surface)',
        }}
      />
      <MiniMap
        style={{
          borderRadius: '8px',
          border: '1px solid var(--border)',
          background: 'var(--surface)',
        }}
        maskColor="rgba(0,0,0,0.3)"
        pannable
        zoomable
        nodeColor={(node) =>
          CATEGORY_COLORS[(node.data as unknown as TechNodeData)?.category] ?? '#64748b'
        }
      />
    </ReactFlow>
  );
}

// ─── Main Component ───

interface TechDependencyChartProps {
  plan: Plan;
  onWideChange?: (wide: boolean) => void;
}

function getGraphCategories(graph: TechGraph): Set<TechCategory> {
  const categories = new Set<TechCategory>();
  for (const node of graph.nodes) categories.add(node.data.category);
  return categories;
}

export function TechDependencyChart({ plan, onWideChange }: TechDependencyChartProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const [wide, setWide] = useState(false);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);

  const graph = useMemo(() => {
    const markdown = normalizePlanMarkdown(plan.content);
    const techs = extractTechnologies(markdown);
    return buildTechGraph(techs);
  }, [plan.id, plan.content]);

  const [activeCategories, setActiveCategories] = useState<Set<TechCategory>>(() =>
    getGraphCategories(graph),
  );

  const nodeTypes = useMemo(() => ({ tech: TechNodeComponent }), []);

  useEffect(() => {
    setActiveCategories(getGraphCategories(graph));
    setFocusedNodeId(null);
  }, [graph]);

  // Filter nodes/edges by active categories
  const filteredGraph = useMemo(() => {
    const nodes = graph.nodes.filter((n) => activeCategories.has(n.data.category));
    const visibleIds = new Set(nodes.map((n) => n.id));
    const edges = graph.edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target));
    return { nodes, edges };
  }, [graph, activeCategories]);

  const adjacencyMap = useMemo(() => buildAdjacencyMap(filteredGraph.edges), [filteredGraph.edges]);

  const presentCategoryCount = useMemo(() => {
    const cats = new Set(filteredGraph.nodes.map((n) => n.data.category));
    return cats.size;
  }, [filteredGraph.nodes]);

  const toggleCategory = useCallback((cat: TechCategory) => {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        if (next.size > 1) next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  }, []);

  const onNodeHover = useCallback((id: string) => setFocusedNodeId(id), []);
  const onNodeLeave = useCallback(() => setFocusedNodeId(null), []);

  const exitFullscreen = useCallback(() => setFullscreen(false), []);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitFullscreen();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [fullscreen, exitFullscreen]);

  if (graph.nodes.length === 0) {
    return (
      <div className="p-8 text-center text-[13px] text-tertiary">
        No technologies detected in this plan
      </div>
    );
  }

  const statsText = `${filteredGraph.nodes.length} of ${graph.nodes.length} technolog${graph.nodes.length === 1 ? 'y' : 'ies'} · ${presentCategoryCount} categor${presentCategoryCount === 1 ? 'y' : 'ies'} · ${filteredGraph.edges.length} connections`;

  const filterPanel = (
    <CategoryFilters graph={graph} activeCategories={activeCategories} onToggle={toggleCategory} />
  );

  if (fullscreen) {
    return (
      <>
        {/* Inline placeholder */}
        <div>
          <div className="text-[12.5px] text-secondary mb-4">{statsText}</div>
          <div className="w-full h-[500px] rounded-xl border border-border overflow-hidden flex items-center justify-center text-[13px] text-tertiary">
            Graph is in fullscreen mode
          </div>
        </div>

        {createPortal(
          <div className="fixed inset-0 z-[9999] bg-bg">
            <div className="w-full h-full">
              <GraphContent
                nodes={filteredGraph.nodes}
                edges={filteredGraph.edges}
                nodeTypes={nodeTypes}
                focusedNodeId={focusedNodeId}
                adjacencyMap={adjacencyMap}
                onNodeHover={onNodeHover}
                onNodeLeave={onNodeLeave}
              />
            </div>

            {/* Floating exit button */}
            <button
              type="button"
              onClick={exitFullscreen}
              title="Exit fullscreen (Esc)"
              className="absolute top-4 right-4 z-[1] px-3.5 py-1.5 text-[12.5px] font-medium font-inherit rounded-lg border border-border bg-surface text-secondary cursor-pointer flex items-center gap-[5px] shadow-[0_2px_12px_rgba(0,0,0,0.08)]"
            >
              <ExitFullscreenIcon />
              Exit
            </button>

            {/* Floating filters + stats */}
            <div className="absolute top-4 left-4 z-[1] px-3.5 py-2.5 rounded-lg border border-border bg-surface shadow-[0_2px_12px_rgba(0,0,0,0.08)] flex flex-col gap-2 max-w-[360px]">
              <div className="text-xs text-secondary">{statsText}</div>
              {filterPanel}
            </div>
          </div>,
          document.body,
        )}
      </>
    );
  }

  return (
    <div
      className="transition-[margin,padding] duration-[250ms] ease-in-out"
      style={
        wide
          ? {
              marginLeft: 'calc(-50vw + 50%)',
              marginRight: 'calc(-50vw + 50%)',
              paddingLeft: '32px',
              paddingRight: '32px',
            }
          : undefined
      }
    >
      <div className="flex items-center justify-between mb-3">
        <div className="text-[12.5px] text-secondary">{statsText}</div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              const next = !wide;
              setWide(next);
              onWideChange?.(next);
            }}
            title={wide ? 'Collapse width' : 'Expand width'}
            className="flex items-center gap-[5px] px-3 py-[5px] text-[12.5px] font-medium font-inherit rounded-[7px] border border-border cursor-pointer"
            style={{
              background: wide ? 'rgba(139,92,246,0.1)' : 'transparent',
              color: wide ? '#8b5cf6' : 'var(--secondary)',
            }}
          >
            {wide ? <CollapseWidthIcon /> : <ExpandWidthIcon />}
            {wide ? 'Collapse' : 'Expand'}
          </button>
          <button
            type="button"
            onClick={() => setFullscreen(true)}
            title="Fullscreen"
            className="flex items-center gap-[5px] px-3 py-[5px] text-[12.5px] font-medium font-inherit rounded-[7px] border border-border bg-transparent text-secondary cursor-pointer"
          >
            <FullscreenIcon />
            Fullscreen
          </button>
        </div>
      </div>

      {/* Category filters */}
      <div className="mb-3">{filterPanel}</div>

      <div
        className="w-full rounded-xl border border-border overflow-hidden transition-[height] duration-[250ms] ease-in-out"
        style={{ height: wide ? '650px' : '500px' }}
      >
        <GraphContent
          nodes={filteredGraph.nodes}
          edges={filteredGraph.edges}
          nodeTypes={nodeTypes}
          focusedNodeId={focusedNodeId}
          adjacencyMap={adjacencyMap}
          onNodeHover={onNodeHover}
          onNodeLeave={onNodeLeave}
        />
      </div>

      {/* Hover hint */}
      <div className="text-[11px] text-tertiary mt-2 text-center">
        Hover a node to highlight its connections · Dashed edges = known relationships
      </div>
    </div>
  );
}
