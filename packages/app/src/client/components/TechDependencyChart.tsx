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
      style={{
        background: `${color}18`,
        borderRadius: '8px',
        borderLeft: `3px solid ${color}`,
        padding: '8px 14px',
        minWidth: '100px',
        position: 'relative',
        transition: 'opacity 0.15s ease',
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ width: '6px', height: '6px', background: color, border: 'none' }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ width: '6px', height: '6px', background: color, border: 'none' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span
          style={{
            fontSize: '13px',
            fontWeight: 550,
            color: 'var(--text)',
            lineHeight: 1.3,
          }}
        >
          {data.label}
        </span>
        {mentionCount > 1 && (
          <span
            style={{
              fontSize: '10px',
              fontWeight: 600,
              padding: '1px 5px',
              borderRadius: '6px',
              background: `${color}30`,
              color,
              lineHeight: 1.4,
            }}
          >
            {mentionCount}
          </span>
        )}
      </div>
      <div
        style={{
          fontSize: '10px',
          opacity: 0.6,
          textTransform: 'uppercase',
          letterSpacing: '0.03em',
          marginTop: '2px',
          color: 'var(--text)',
        }}
      >
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
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
      <span style={{ fontSize: '11px', color: 'var(--tertiary)', marginRight: '2px' }}>
        Filter:
      </span>
      {presentCategories.map((cat) => {
        const color = CATEGORY_COLORS[cat];
        const active = activeCategories.has(cat);
        const count = categoryCounts.get(cat) ?? 0;
        return (
          <button
            type="button"
            key={cat}
            onClick={() => onToggle(cat)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '3px 10px',
              fontSize: '11px',
              fontWeight: 500,
              fontFamily: 'inherit',
              borderRadius: '6px',
              border: `1px solid ${active ? `${color}40` : 'var(--border)'}`,
              background: active ? `${color}15` : 'transparent',
              color: active ? color : 'var(--tertiary)',
              cursor: 'pointer',
              opacity: active ? 1 : 0.6,
              transition: 'all 0.15s ease',
              textTransform: 'capitalize',
            }}
          >
            <div
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background: active ? color : 'var(--tertiary)',
                flexShrink: 0,
              }}
            />
            {cat}
            <span style={{ opacity: 0.6 }}>({count})</span>
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
      style={{ width: '13px', height: '13px' }}
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
      style={{ width: '13px', height: '13px' }}
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
      style={{ width: '13px', height: '13px' }}
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
      style={{ width: '13px', height: '13px' }}
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

export function TechDependencyChart({ plan, onWideChange }: TechDependencyChartProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const [wide, setWide] = useState(false);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);

  const graph = useMemo(() => {
    const markdown = normalizePlanMarkdown(plan.content);
    const techs = extractTechnologies(markdown);
    return buildTechGraph(techs);
  }, [plan.content]);

  const [activeCategories, setActiveCategories] = useState<Set<TechCategory>>(() => {
    const cats = new Set<TechCategory>();
    for (const n of graph.nodes) cats.add(n.data.category);
    return cats;
  });

  const nodeTypes = useMemo(() => ({ tech: TechNodeComponent }), []);

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
      <div
        style={{
          padding: '32px',
          textAlign: 'center',
          fontSize: '13px',
          color: 'var(--tertiary)',
        }}
      >
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
          <div
            style={{
              fontSize: '12.5px',
              color: 'var(--secondary)',
              marginBottom: '16px',
            }}
          >
            {statsText}
          </div>
          <div
            style={{
              width: '100%',
              height: '500px',
              borderRadius: '12px',
              border: '1px solid var(--border)',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '13px',
              color: 'var(--tertiary)',
            }}
          >
            Graph is in fullscreen mode
          </div>
        </div>

        {createPortal(
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 9999,
              background: 'var(--bg)',
            }}
          >
            <div style={{ width: '100%', height: '100%' }}>
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
              style={{
                position: 'absolute',
                top: '16px',
                right: '16px',
                zIndex: 1,
                padding: '6px 14px',
                fontSize: '12.5px',
                fontWeight: 500,
                fontFamily: 'inherit',
                borderRadius: '8px',
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--secondary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
              }}
            >
              <ExitFullscreenIcon />
              Exit
            </button>

            {/* Floating filters + stats */}
            <div
              style={{
                position: 'absolute',
                top: '16px',
                left: '16px',
                zIndex: 1,
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                maxWidth: '360px',
              }}
            >
              <div style={{ fontSize: '12px', color: 'var(--secondary)' }}>{statsText}</div>
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
      style={
        wide
          ? {
              marginLeft: 'calc(-50vw + 50%)',
              marginRight: 'calc(-50vw + 50%)',
              paddingLeft: '32px',
              paddingRight: '32px',
              transition: 'margin 0.25s ease, padding 0.25s ease',
            }
          : {
              transition: 'margin 0.25s ease, padding 0.25s ease',
            }
      }
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '12px',
        }}
      >
        <div style={{ fontSize: '12.5px', color: 'var(--secondary)' }}>{statsText}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            type="button"
            onClick={() => {
              const next = !wide;
              setWide(next);
              onWideChange?.(next);
            }}
            title={wide ? 'Collapse width' : 'Expand width'}
            style={{
              padding: '5px 12px',
              fontSize: '12.5px',
              fontWeight: 500,
              fontFamily: 'inherit',
              borderRadius: '7px',
              border: '1px solid var(--border)',
              background: wide ? 'rgba(139,92,246,0.1)' : 'transparent',
              color: wide ? '#8b5cf6' : 'var(--secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
            }}
          >
            {wide ? <CollapseWidthIcon /> : <ExpandWidthIcon />}
            {wide ? 'Collapse' : 'Expand'}
          </button>
          <button
            type="button"
            onClick={() => setFullscreen(true)}
            title="Fullscreen"
            style={{
              padding: '5px 12px',
              fontSize: '12.5px',
              fontWeight: 500,
              fontFamily: 'inherit',
              borderRadius: '7px',
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
            }}
          >
            <FullscreenIcon />
            Fullscreen
          </button>
        </div>
      </div>

      {/* Category filters */}
      <div style={{ marginBottom: '12px' }}>{filterPanel}</div>

      <div
        style={{
          width: '100%',
          height: wide ? '650px' : '500px',
          borderRadius: '12px',
          border: '1px solid var(--border)',
          overflow: 'hidden',
          transition: 'height 0.25s ease',
        }}
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
      <div
        style={{
          fontSize: '11px',
          color: 'var(--tertiary)',
          marginTop: '8px',
          textAlign: 'center',
        }}
      >
        Hover a node to highlight its connections · Dashed edges = known relationships
      </div>
    </div>
  );
}
