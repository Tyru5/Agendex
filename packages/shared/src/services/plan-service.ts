import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { lstat, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { getActiveAdapters } from '../adapters/registry.ts';
import { getConfigDir, loadConfig } from '../config.ts';
import { hashPath } from '../hash.ts';
import type { AgentAdapter, Plan, PlannotatorWritebackPayload } from '../types.ts';
import { annotatePlanValueMetadata, isIndexablePlan } from './plan-value.ts';

function getUserPlansDir(): string {
  return join(getConfigDir(), 'plans');
}

/** Live index; replaced atomically at end of `scan()` so readers never see a cleared/partial map. */
let store = new Map<string, Plan>();
const MAX_DEPTH = 6;
const DISCOVERY_MAX_DEPTH = 4;

const PROJECT_PLAN_MARKERS = [
  { marker: '.codebuddy/plans', agent: 'codebuddy' },
  { marker: '.factory/docs', agent: 'droid' },
  { marker: '.gemini/antigravity/artifacts', agent: 'antigravity' },
  { marker: '.gemini/plans', agent: 'gemini-cli' },
  { marker: '.junie/plans', agent: 'junie' },
  { marker: '.kilo/plans', agent: 'kilo-cli' },
  { marker: '.kiro/specs', agent: 'kiro-cli' },
  { marker: '.qwen/plans', agent: 'qwen-code' },
  { marker: '.sisyphus/plans', agent: 'oh-my-opencode' },
  { marker: '@plans', agent: 'plannotator' },
];

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.cache',
  'vendor',
  'venv',
  '__pycache__',
  'target',
  '.next',
  '.nuxt',
  // macOS
  'Library',
  'Applications',
  'Music',
  'Movies',
  'Pictures',
  'Public',
  // Windows
  'AppData',
  'Application Data',
  'Program Files',
  'Program Files (x86)',
  'Windows',
  'ProgramData',
  // Linux
  'snap',
  // Common non-dev
  'Downloads',
  'Desktop',
  'Dropbox',
  'OneDrive',
  'Google Drive',
  'iCloud Drive',
]);

export interface DiscoveredPlanDir {
  dir: string;
  agent: string;
}

function getRuntimeHomeDir(): string {
  const homeFromEnv =
    process.env.HOME ||
    process.env.USERPROFILE ||
    (process.env.HOMEDRIVE && process.env.HOMEPATH
      ? `${process.env.HOMEDRIVE}${process.env.HOMEPATH}`
      : undefined);

  return resolve(homeFromEnv || homedir());
}

export function discoverProjectPlanDirs(): DiscoveredPlanDir[] {
  const home = canonicalPath(getRuntimeHomeDir());
  const results: DiscoveredPlanDir[] = [];
  const seen = new Set<string>();
  let nearestAncestorMarkerRoot: string | undefined;

  function addResult(dir: string, agent: string) {
    const resolved = canonicalPath(dir);
    const key = `${agent}:${resolved}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ dir: resolved, agent });
  }

  function inspectMarkers(dir: string): boolean {
    let found = false;
    for (const { marker, agent } of PROJECT_PLAN_MARKERS) {
      const candidate = join(dir, marker);
      if (existsSync(candidate)) {
        addResult(candidate, agent);
        found = true;
      }
    }
    return found;
  }

  function walkAncestorsForCurrentProject() {
    let dir = canonicalPath(process.cwd());
    while (true) {
      if (inspectMarkers(dir)) {
        nearestAncestorMarkerRoot = dir;
        return;
      }
      if (dir === home) return;
      const parent = dirname(dir);
      if (parent === dir) return;
      dir = parent;
    }
  }

  function isAncestorOfNearestMarker(dir: string): boolean {
    return Boolean(nearestAncestorMarkerRoot?.startsWith(dir + sep));
  }

  function walk(dir: string, depth: number) {
    if (depth > DISCOVERY_MAX_DEPTH) return;

    const resolved = canonicalPath(dir);
    if (!isAncestorOfNearestMarker(resolved) && inspectMarkers(dir)) return;

    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }

    for (const name of names) {
      if (name.startsWith('.') && name !== '.sisyphus') continue;
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      try {
        if (statSync(full).isDirectory()) walk(full, depth + 1);
      } catch {
        // Ignore inaccessible entries and keep scanning siblings.
      }
    }
  }

  walkAncestorsForCurrentProject();
  walk(home, 0);
  return results;
}

let onPlansChangedCallback: ((plans: Plan[]) => void) | undefined;

export function setOnPlansChanged(callback: (plans: Plan[]) => void) {
  onPlansChangedCallback = callback;
}

function notifyPlansChanged() {
  onPlansChangedCallback?.(Array.from(store.values()));
}

async function walkDir(dir: string, depth = 0, seen = new Set<string>()): Promise<string[]> {
  if (depth > MAX_DEPTH) return [];
  if (!existsSync(dir)) return [];

  const real = resolve(dir);
  if (seen.has(real)) return [];
  seen.add(real);

  const files: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      try {
        const stats = await lstat(full);
        if (stats.isSymbolicLink()) continue;
        if (stats.isDirectory()) {
          files.push(...(await walkDir(full, depth + 1, seen)));
        } else {
          files.push(full);
        }
      } catch {
        // Ignore inaccessible entries and keep scanning siblings.
      }
    }
  } catch {
    // permission denied or similar
  }
  return files;
}

function preparePlanForIndex(plan: Plan): Plan {
  return annotatePlanValueMetadata(plan);
}

async function parseGenericMarkdownPlan(
  filePath: string,
  extraMetadata: Record<string, unknown>,
): Promise<Plan | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const stats = await stat(filePath);

    let agent =
      (typeof extraMetadata.agentHint === 'string' ? extraMetadata.agentHint : '') || 'unknown';
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
    if (fmMatch) {
      const agentLine = fmMatch[1]?.match(/^agent:\s*(.+)$/m);
      if (agentLine?.[1]) agent = agentLine[1].trim();
    }

    const bodyContent = fmMatch ? content.slice(fmMatch[0].length) : content;
    const titleMatch = bodyContent.match(/^#\s+(.+)/m);
    const title =
      titleMatch?.[1]?.trim() || filePath.split('/').pop()?.replace('.md', '') || 'Untitled';

    return {
      id: hashPath(filePath),
      agent,
      title,
      content: bodyContent,
      filePath,
      format: 'md',
      createdAt: stats.birthtime,
      updatedAt: stats.mtime,
      metadata: extraMetadata,
    };
  } catch {
    return null;
  }
}

async function scanUserPlans(into: Map<string, Plan>) {
  const userPlansDir = getUserPlansDir();
  if (!existsSync(userPlansDir)) return;
  const files = await walkDir(userPlansDir);
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const plan = await parseGenericMarkdownPlan(file, { userCreated: true, userPlansDir });
    if (plan) into.set(plan.id, preparePlanForIndex(plan));
  }
}

export function getCustomPlanDirs(): string[] {
  return loadConfig()?.customPlanDirs ?? [];
}

function canonicalPath(path: string): string {
  const resolved = resolve(path);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

/** True if paths are equal or one is a descendant of the other in the filesystem tree. */
export function pathsOverlapFilesystemTree(a: string, b: string): boolean {
  const ra = canonicalPath(a);
  const rb = canonicalPath(b);
  if (ra === rb) return true;
  if (ra.startsWith(rb + sep)) return true;
  if (rb.startsWith(ra + sep)) return true;
  return false;
}

function overlapsAnyRoot(candidate: string, roots: Iterable<string>): boolean {
  const resolvedCandidate = canonicalPath(candidate);
  for (const root of roots) {
    if (pathsOverlapFilesystemTree(resolvedCandidate, root)) return true;
  }
  return false;
}

async function scanCustomPlanDirs(coveredPaths: Set<string>, into: Map<string, Plan>) {
  const dirs = getCustomPlanDirs();
  const userPlansDir = canonicalPath(getUserPlansDir());
  for (const dir of dirs) {
    const resolved = canonicalPath(dir);
    if (overlapsAnyRoot(resolved, coveredPaths)) {
      console.log(`[agendex] skipping custom dir (overlaps adapter / discovered coverage): ${dir}`);
      continue;
    }
    if (pathsOverlapFilesystemTree(resolved, userPlansDir)) {
      console.log(`[agendex] skipping custom dir (overlaps user plans): ${dir}`);
      continue;
    }
    if (!existsSync(dir)) {
      console.log(`[agendex] skipping custom dir (not found): ${dir}`);
      continue;
    }
    const files = await walkDir(dir);
    const dirBasename =
      dir
        .replace(/[\\/]+$/, '')
        .split(/[\\/]/)
        .pop() ?? 'custom';
    let count = 0;
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const plan = await parseGenericMarkdownPlan(file, {
        source: 'custom-dir',
        customDir: dir,
        agentHint: dirBasename,
      });
      if (plan) {
        into.set(plan.id, preparePlanForIndex(plan));
        count++;
      }
    }
    console.log(`[agendex] custom dir: ${dir} (${count} plans)`);
  }
}

export async function scan() {
  const adapters = getActiveAdapters();
  const next = new Map<string, Plan>();

  const coveredPaths = new Set<string>();
  for (const adapter of adapters) {
    for (const searchPath of adapter.getSearchPaths()) {
      coveredPaths.add(canonicalPath(searchPath));
      const files = await walkDir(searchPath);
      for (const file of files) {
        if (!adapter.matches(file, searchPath)) continue;
        const plans = await adapter.parse(file, searchPath);
        for (const plan of plans) {
          const annotated = preparePlanForIndex(plan);
          next.set(annotated.id, annotated);
        }
      }
    }
  }

  const discovered = discoverProjectPlanDirs();
  for (const { dir, agent } of discovered) {
    const resolvedDir = canonicalPath(dir);
    if (coveredPaths.has(resolvedDir)) continue;
    const adapter = adapters.find((a) => a.agent === agent);
    if (!adapter) continue;
    const files = await walkDir(dir);
    for (const file of files) {
      if (!adapter.matches(file, dir)) continue;
      const plans = await adapter.parse(file, dir);
      for (const plan of plans) {
        const annotated = preparePlanForIndex(plan);
        next.set(annotated.id, annotated);
      }
    }
    coveredPaths.add(resolvedDir);
    console.log(`[agendex] discovered project plans: ${dir}`);
  }

  await scanUserPlans(next);
  await scanCustomPlanDirs(coveredPaths, next);

  store = next;
  notifyPlansChanged();
  const indexableCount = getIndexablePlans().length;
  const hiddenCount = store.size - indexableCount;
  const hiddenSuffix = hiddenCount > 0 ? ` (${hiddenCount} hidden as low-value)` : '';
  console.log(
    `[agendex] indexed ${indexableCount} plans${hiddenSuffix} from ${adapters.length} adapters`,
  );
}

export function getAll(): Plan[] {
  return Array.from(store.values());
}

export function getIndexablePlans(): Plan[] {
  return getAll().filter(isIndexablePlan);
}

export function getById(id: string): Plan | undefined {
  return store.get(id);
}

export function getIndexableById(id: string): Plan | undefined {
  const plan = store.get(id);
  return plan && isIndexablePlan(plan) ? plan : undefined;
}

function isUserPlan(plan: Plan): boolean {
  return resolve(plan.filePath).startsWith(resolve(getUserPlansDir()) + sep);
}

function getPlanSourceAdapter(plan: Plan): string | undefined {
  const sourceAdapter = plan.metadata.sourceAdapter;
  return typeof sourceAdapter === 'string' && sourceAdapter.trim() ? sourceAdapter : undefined;
}

function findAdapterForPlan(plan: Plan) {
  const adapters = getActiveAdapters();
  const sourceAdapter = getPlanSourceAdapter(plan);
  return (
    adapters.find((adapter) => adapter.agent === sourceAdapter) ??
    adapters.find((adapter) => adapter.agent === plan.agent)
  );
}

export async function update(id: string, content: string): Promise<boolean> {
  const plan = store.get(id);
  if (!plan) return false;

  if (isUserPlan(plan)) {
    try {
      const raw = await readFile(plan.filePath, 'utf-8');
      const fmMatch = raw.match(/^---\s*\n[\s\S]*?\n---\s*\n/);
      const prefix = fmMatch ? fmMatch[0] : '';
      await writeFile(plan.filePath, prefix + content, 'utf-8');
      plan.content = content;
      plan.updatedAt = new Date();
      notifyPlansChanged();
      return true;
    } catch {
      return false;
    }
  }

  const adapter = findAdapterForPlan(plan);
  if (!adapter?.writable) return false;

  const ok = await adapter.write(plan, content);
  if (ok) {
    plan.content = content;
    plan.updatedAt = new Date();
    notifyPlansChanged();
  }
  return ok;
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'plan'
  );
}

export async function requestChanges(
  id: string,
  payload: PlannotatorWritebackPayload,
): Promise<boolean> {
  const plan = store.get(id);
  if (!plan) return false;

  const adapter = findAdapterForPlan(plan);
  if (!adapter?.requestChanges) return false;

  const ok = await adapter.requestChanges(plan, payload);
  if (ok) {
    const writebackAt = Date.now();
    const plannotator =
      typeof plan.metadata.plannotator === 'object' && plan.metadata.plannotator !== null
        ? {
            ...plan.metadata.plannotator,
            ...(payload.action === 'approve' ? { status: 'approved' } : {}),
            lastWritebackStatus: 'sent',
            lastWritebackAt: writebackAt,
          }
        : undefined;
    if (plannotator) plan.metadata = { ...plan.metadata, plannotator };
    plan.updatedAt = new Date();
    notifyPlansChanged();
  }
  return ok;
}

export async function create(agentName: string, title: string, content: string): Promise<Plan> {
  const adapters = getActiveAdapters();
  const adapter = adapters.find((a) => a.agent === agentName);
  const slug = slugify(title);
  const timestamp = Date.now();
  const filename = `${slug}-${timestamp}.md`;

  let filePath: string;
  let fileContent: string;

  const userPlansDir = getUserPlansDir();
  if (adapter?.writable) {
    const dir = adapter.getSearchPaths()[0] ?? userPlansDir;
    await mkdir(dir, { recursive: true });
    filePath = join(dir, filename);
    fileContent = `# ${title}\n\n${content}`;
  } else {
    await mkdir(userPlansDir, { recursive: true });
    filePath = join(userPlansDir, filename);
    fileContent = `---\nagent: ${agentName}\n---\n# ${title}\n\n${content}`;
  }

  await writeFile(filePath, fileContent, 'utf-8');

  const now = new Date();
  const plan: Plan = {
    id: hashPath(filePath),
    agent: agentName,
    title,
    content: `# ${title}\n\n${content}`,
    filePath,
    format: 'md',
    createdAt: now,
    updatedAt: now,
    metadata: adapter?.writable ? {} : { userCreated: true },
  };

  const annotated = preparePlanForIndex(plan);
  store.set(annotated.id, annotated);
  notifyPlansChanged();
  return annotated;
}

export function getAgentStats() {
  const adapters = getActiveAdapters();
  const stats = new Map<string, { count: number; writable: boolean }>();
  for (const adapter of adapters) {
    stats.set(adapter.agent, { count: 0, writable: adapter.writable });
  }
  for (const plan of store.values()) {
    if (!isIndexablePlan(plan)) continue;
    const s = stats.get(plan.agent);
    if (s) s.count++;
  }
  return Array.from(stats.entries()).map(([agent, s]) => ({
    agent,
    planCount: s.count,
    writable: s.writable,
  }));
}

function planBelongsToAdapter(plan: Plan, adapter: AgentAdapter): boolean {
  if (plan.agent === adapter.agent) return true;
  return (
    adapter.agent === 'plannotator' &&
    typeof plan.metadata.plannotator === 'object' &&
    plan.metadata.plannotator !== null
  );
}

function removePlansForPath(filePath: string, adapter?: AgentAdapter): Plan[] {
  const normalized = resolve(filePath);
  const removed: Plan[] = [];
  for (const [id, plan] of store.entries()) {
    const planPath = resolve(plan.filePath);
    const sessionPath =
      typeof plan.metadata.plannotator === 'object' && plan.metadata.plannotator !== null
        ? (plan.metadata.plannotator as Record<string, unknown>).sessionPath
        : undefined;
    const sourcePaths = Array.isArray(plan.metadata.sourcePaths)
      ? plan.metadata.sourcePaths.filter((path): path is string => typeof path === 'string')
      : [];
    if (
      (planPath === normalized ||
        sessionPath === normalized ||
        sourcePaths.some((path) => resolve(path) === normalized)) &&
      (!adapter || planBelongsToAdapter(plan, adapter))
    ) {
      removed.push(plan);
      store.delete(id);
    }
  }
  if (removed.length > 0) notifyPlansChanged();
  return removed;
}

export async function rescanFile(filePath: string) {
  const adapters = getActiveAdapters();
  const normalized = resolve(filePath);
  const removedPlans: Plan[] = [];

  for (const adapter of adapters) {
    const discoveredDirs = discoverProjectPlanDirs()
      .filter((d) => d.agent === adapter.agent)
      .map((d) => resolve(d.dir));

    const allSearchPaths = [
      ...adapter.getSearchPaths().map((sp) => resolve(sp)),
      ...discoveredDirs,
    ];

    const scanRoot = allSearchPaths.find(
      (sp) => normalized.startsWith(sp + sep) || normalized === sp,
    );

    if (!scanRoot || !adapter.matches(filePath, scanRoot)) continue;

    const rawPlans = await adapter.parse(filePath, scanRoot);
    if (rawPlans.length === 0) {
      removedPlans.push(...removePlansForPath(filePath, adapter));
      continue;
    }
    const plans = rawPlans.map(preparePlanForIndex);
    for (const plan of plans) {
      store.set(plan.id, plan);
    }
    notifyPlansChanged();
    return plans;
  }

  if (removedPlans.length > 0) return removedPlans;

  // Check user plans dir
  const userPlansDir = resolve(getUserPlansDir());
  if (
    normalized.endsWith('.md') &&
    (normalized.startsWith(userPlansDir + sep) || normalized === userPlansDir)
  ) {
    const plan = await parseGenericMarkdownPlan(filePath, { userCreated: true, userPlansDir });
    if (plan) {
      const annotated = preparePlanForIndex(plan);
      store.set(annotated.id, annotated);
      notifyPlansChanged();
      return [annotated];
    }
  }

  // Check custom plan dirs
  if (normalized.endsWith('.md')) {
    const customDirs = getCustomPlanDirs();
    for (const dir of customDirs) {
      const resolvedDir = resolve(dir);
      if (normalized.startsWith(resolvedDir + sep) || normalized === resolvedDir) {
        const plan = await parseGenericMarkdownPlan(filePath, {
          source: 'custom-dir',
          customDir: dir,
        });
        if (plan) {
          const annotated = preparePlanForIndex(plan);
          store.set(annotated.id, annotated);
          notifyPlansChanged();
          return [annotated];
        }
      }
    }
  }

  return [];
}
