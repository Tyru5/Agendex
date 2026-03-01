import dagre from '@dagrejs/dagre';
import type { Edge, Node } from '@xyflow/react';
import type { DetectedTech, TechCategory } from './tech-extract.ts';

export type TechNodeData = {
  label: string;
  category: TechCategory;
  confidence: number;
  iconSlug?: string;
  mentionCount: number;
  [key: string]: unknown;
};

export type TechNode = Node<TechNodeData, 'tech'>;
export type TechEdge = Edge & {
  data?: {
    kind: 'cooccur' | 'known';
    weight: number;
  };
};

export interface TechGraph {
  nodes: TechNode[];
  edges: TechEdge[];
}

export const CATEGORY_COLORS: Record<TechCategory, string> = {
  language: '#3b82f6',
  runtime: '#f97316',
  framework: '#8b5cf6',
  library: '#06b6d4',
  tooling: '#eab308',
  database: '#22c55e',
  cloud: '#ec4899',
  testing: '#14b8a6',
};

const KNOWN_RELATIONS: Record<string, string[]> = {
  React: [
    'TypeScript',
    'JavaScript',
    'Vite',
    'Next.js',
    'Redux',
    'Zustand',
    'React Router',
    'Tailwind CSS',
  ],
  'Next.js': ['React', 'TypeScript', 'Vercel'],
  Vue: ['TypeScript', 'JavaScript', 'Vite', 'Nuxt'],
  Svelte: ['TypeScript', 'JavaScript', 'Vite', 'SvelteKit'],
  'Node.js': ['Express', 'Hono', 'Fastify', 'NestJS', 'TypeScript', 'JavaScript'],
  Bun: ['TypeScript', 'JavaScript', 'Hono'],
  Deno: ['TypeScript', 'JavaScript'],
  PostgreSQL: ['Prisma', 'Drizzle', 'Node.js', 'Supabase', 'Neon'],
  MongoDB: ['Node.js', 'Prisma'],
  Redis: ['Node.js'],
  Prisma: ['TypeScript', 'PostgreSQL', 'MySQL', 'SQLite'],
  Drizzle: ['TypeScript', 'PostgreSQL', 'MySQL', 'SQLite'],
  Express: ['Node.js', 'TypeScript'],
  Hono: ['Bun', 'Node.js', 'TypeScript', 'Cloudflare'],
  'Tailwind CSS': ['PostCSS', 'Vite'],
  Docker: ['Kubernetes'],
  Vite: ['TypeScript', 'React', 'Vue', 'Svelte'],
  Vercel: ['Next.js', 'React'],
  Supabase: ['PostgreSQL'],
  Convex: ['React', 'TypeScript'],
  Firebase: ['React', 'JavaScript'],
  Django: ['Python', 'PostgreSQL'],
  Flask: ['Python'],
  FastAPI: ['Python'],
  Rails: ['Ruby', 'PostgreSQL'],
  'Spring Boot': ['Java'],
};

const NODE_WIDTH = 160;
const NODE_HEIGHT = 50;
const TOP_K_EDGES_PER_NODE = 4;
const MIN_COOCCUR_WEIGHT = 2;

export function buildTechGraph(techs: DetectedTech[]): TechGraph {
  const filtered = techs.filter((t) => t.confidence >= 0.5);

  const nodes: TechNode[] = filtered.map((t) => ({
    id: t.canonical,
    type: 'tech' as const,
    position: { x: 0, y: 0 },
    data: {
      label: t.canonical,
      category: t.category,
      confidence: t.confidence,
      iconSlug: t.iconSlug,
      mentionCount: t.sources.length,
    },
  }));

  const presentNames = new Set(filtered.map((t) => t.canonical));
  const edgeSet = new Set<string>();
  let allCooccurEdges: TechEdge[] = [];
  const edges: TechEdge[] = [];

  // Co-occurrence edges (collect all, then prune)
  for (let i = 0; i < filtered.length; i++) {
    for (let j = i + 1; j < filtered.length; j++) {
      const a = filtered[i];
      const b = filtered[j];
      if (!a || !b) continue;
      const sharedParagraphs = a.paragraphIndices.filter((p) => b.paragraphIndices.includes(p));
      if (sharedParagraphs.length === 0) continue;

      const [src, tgt] = [a.canonical, b.canonical].sort() as [string, string];
      const edgeId = `cooccur-${src}-${tgt}`;

      allCooccurEdges.push({
        id: edgeId,
        source: src,
        target: tgt,
        type: 'smoothstep',
        data: { kind: 'cooccur', weight: sharedParagraphs.length },
        style: {
          strokeWidth: Math.min(2.5, Math.max(1, sharedParagraphs.length * 0.8)),
          stroke: 'rgba(148, 163, 184, 0.35)',
        },
      });
    }
  }

  // Prune co-occurrence edges: threshold + top-K per node
  const shouldPrune = filtered.length > 15;
  if (shouldPrune) {
    allCooccurEdges = allCooccurEdges.filter((e) => (e.data?.weight ?? 0) >= MIN_COOCCUR_WEIGHT);

    // Top-K: for each node keep only its K strongest co-occur edges
    const keptEdgeIds = new Set<string>();
    for (const node of nodes) {
      const incident = allCooccurEdges
        .filter((e) => e.source === node.id || e.target === node.id)
        .sort((a, b) => (b.data?.weight ?? 0) - (a.data?.weight ?? 0))
        .slice(0, TOP_K_EDGES_PER_NODE);
      for (const e of incident) keptEdgeIds.add(e.id);
    }
    allCooccurEdges = allCooccurEdges.filter((e) => keptEdgeIds.has(e.id));
  }

  for (const e of allCooccurEdges) {
    edgeSet.add(e.id);
    edges.push(e);
  }

  // Known relationship edges
  for (const [tech, related] of Object.entries(KNOWN_RELATIONS)) {
    if (!presentNames.has(tech)) continue;
    for (const rel of related) {
      if (!presentNames.has(rel)) continue;

      const [src, tgt] = [tech, rel].sort() as [string, string];
      const cooccurId = `cooccur-${src}-${tgt}`;
      if (edgeSet.has(cooccurId)) continue;

      const edgeId = `known-${src}-${tgt}`;
      if (edgeSet.has(edgeId)) continue;
      edgeSet.add(edgeId);

      edges.push({
        id: edgeId,
        source: src,
        target: tgt,
        type: 'smoothstep',
        data: { kind: 'known', weight: 1 },
        style: {
          strokeWidth: 1,
          stroke: 'rgba(148, 163, 184, 0.25)',
          strokeDasharray: '4 3',
        },
      });
    }
  }

  // Dagre layout — TB with tighter grouping
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: 'TB',
    ranker: 'tight-tree',
    nodesep: 50,
    ranksep: 80,
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target, { weight: edge.data?.weight ?? 1 });
  }

  dagre.layout(g);

  for (const node of nodes) {
    const pos = g.node(node.id);
    node.position = {
      x: pos.x - NODE_WIDTH / 2,
      y: pos.y - NODE_HEIGHT / 2,
    };
  }

  return { nodes, edges };
}

/** Build adjacency map for fast neighbor lookups */
export function buildAdjacencyMap(edges: TechEdge[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!map.has(edge.source)) map.set(edge.source, new Set());
    if (!map.has(edge.target)) map.set(edge.target, new Set());
    map.get(edge.source)?.add(edge.target);
    map.get(edge.target)?.add(edge.source);
  }
  return map;
}
