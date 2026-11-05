import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { lstat, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { errorCode, isMissingSourceError } from '../adapters/adapter-utils.ts';
import { getParseCacheDependencies } from '../adapters/parse-cache.ts';
import { getActiveAdapters } from '../adapters/registry.ts';
import { CURRENT_CONFIG_VERSION, getConfigDir, loadConfig, updateConfig } from '../config.ts';
import { getHomeDir } from '../home-dir.ts';
import { hashPath } from '../hash.ts';
import { clearPlanRepoRootCache, resolvePlanRepoRootCached } from '../git.ts';
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

let discoveredPlanDirsCache: { key: string; dirs: DiscoveredPlanDir[] } | undefined;

export interface DiscoverProjectPlanDirsOptions {
  /**
   * Reuse the dirs found by the last walk (for the same home and working
   * directory) instead of walking `$HOME` again. Full scans and watcher setup
   * walk; per-file rescans and watch-path diffing reuse their result.
   */
  useCache?: boolean;
}

export function discoverProjectPlanDirs(
  options: DiscoverProjectPlanDirsOptions = {},
): DiscoveredPlanDir[] {
  const cacheKey = `${getHomeDir()}\0${process.cwd()}`;
  if (options.useCache && discoveredPlanDirsCache?.key === cacheKey) {
    return [...discoveredPlanDirsCache.dirs];
  }
  const dirs = walkForProjectPlanDirs();
  discoveredPlanDirsCache = { key: cacheKey, dirs };
  return [...dirs];
}

function walkForProjectPlanDirs(): DiscoveredPlanDir[] {
  const home = canonicalPath(getHomeDir());
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

let localValueOverrides: Record<string, string> = {};

/**
 * A restored source must stay missing this long before its override is dropped, so an
 * atomic save or a briefly unavailable mount does not undo the restore, while a plan
 * created at the same path after a real deletion still starts hidden.
 */
const DEFAULT_OVERRIDE_DELETE_GRACE_MS = 5 * 60_000;
const overrideSourceMissingSince = new Map<string, number>();

function overrideDeleteGraceMs(): number {
  const raw = process.env.AGENDEX_OVERRIDE_DELETE_GRACE_MS;
  const parsed = raw === undefined || raw === '' ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_OVERRIDE_DELETE_GRACE_MS;
}

/**
 * Forget restores whose plan left the index and whose source stayed deleted past the
 * grace period. An indexed plan keeps its restore even when its recorded path is not a
 * file on disk (for example a live session reporting an unavailable source path).
 */
function pruneDeletedValueOverrides(ids: Iterable<string>, now = Date.now()): void {
  const graceMs = overrideDeleteGraceMs();
  const stale: string[] = [];
  for (const id of ids) {
    const sourcePath = localValueOverrides[id];
    if (sourcePath === undefined) continue;
    if (store.has(id) || existsSync(sourcePath)) {
      overrideSourceMissingSince.delete(id);
      continue;
    }
    const since = overrideSourceMissingSince.get(id) ?? now;
    overrideSourceMissingSince.set(id, since);
    if (now - since >= graceMs) stale.push(id);
  }
  if (stale.length === 0) return;
  updateConfig((config) => {
    if (!config?.planValueOverrides) return null;
    const planValueOverrides = { ...config.planValueOverrides };
    for (const id of stale) delete planValueOverrides[id];
    return { ...config, planValueOverrides };
  });
  for (const id of stale) {
    delete localValueOverrides[id];
    overrideSourceMissingSince.delete(id);
  }
}

function loadValueOverrides(): Record<string, string> {
  return loadConfig()?.planValueOverrides ?? {};
}

/**
 * `overrides` is the snapshot the caller loaded: a full scan builds its whole
 * index from one snapshot even if a concurrent rescan reloads the config.
 */
function preparePlanForIndex(plan: Plan, overrides = localValueOverrides): Plan {
  const metadata = { ...plan.metadata };
  if (metadata.localPlanValueOverride === true) {
    delete metadata.planValueOverride;
    delete metadata.localPlanValueOverride;
  }
  if (overrides[plan.id] !== undefined) {
    metadata.planValueOverride = 'manual';
    metadata.localPlanValueOverride = true;
  }
  plan = { ...plan, metadata };
  const workspace = plan.workspace ?? resolvePlanRepoRootCached(plan) ?? undefined;
  return annotatePlanValueMetadata(workspace ? { ...plan, workspace } : plan);
}

/**
 * Sources whose last read failed, with the error code already logged, so a
 * persistently unreadable source warns once instead of on every poll.
 */
const reportedSourceFailures = new Map<string, string>();

function reportSourceFailure(sourcePath: string, err: unknown): void {
  const key = resolve(sourcePath);
  const code = errorCode(err) ?? (err instanceof Error ? err.name : 'unknown');
  if (reportedSourceFailures.get(key) === code) return;
  reportedSourceFailures.set(key, code);
  const message = err instanceof Error ? err.message : String(err);
  console.warn(
    `[agendex] could not read plan source ${sourcePath} (${code}); keeping its previous plans: ${message}`,
  );
}

function clearSourceFailure(sourcePath: string): void {
  reportedSourceFailures.delete(resolve(sourcePath));
}

/**
 * Raw (pre-`preparePlanForIndex`) parse results from the last full scan, keyed
 * by resolved source path, then by parse scope (adapter + scan root, or the
 * generic markdown metadata). A full scan reuses an entry while the stat
 * fingerprint of the source's dependencies is unchanged.
 */
type ParseCache = Map<string, Map<string, { fingerprint: string; plans: Plan[] }>>;
let parseCache: ParseCache = new Map();
let parseCacheAdapterKey = '';

async function statFingerprint(paths: string[]): Promise<string | undefined> {
  const parts: string[] = [];
  for (const path of paths) {
    try {
      const stats = await stat(path);
      parts.push(`${stats.size}:${stats.mtimeMs}`);
    } catch (err) {
      if (!isMissingSourceError(err)) return undefined;
      parts.push('-');
    }
  }
  return parts.join('|');
}

/**
 * Parse one source during a full scan, reusing the previous result when its
 * fingerprint is unchanged. `dependencies` undefined disables caching. Returns
 * undefined when the read failed; the failure is logged and callers keep the
 * source's previous plans instead of treating it as empty.
 */
async function parseSourceForScan(
  sourcePath: string,
  scope: string,
  dependencies: string[] | undefined,
  parse: () => Promise<Plan[]>,
  nextCache: ParseCache,
): Promise<Plan[] | undefined> {
  const sourceKey = resolve(sourcePath);
  const fingerprint = dependencies ? await statFingerprint(dependencies) : undefined;
  const remember = (plans: Plan[]) => {
    if (fingerprint === undefined) return;
    let scopes = nextCache.get(sourceKey);
    if (!scopes) nextCache.set(sourceKey, (scopes = new Map()));
    scopes.set(scope, { fingerprint, plans });
  };
  const cached = fingerprint === undefined ? undefined : parseCache.get(sourceKey)?.get(scope);
  if (cached && cached.fingerprint === fingerprint) {
    remember(cached.plans);
    return cached.plans;
  }
  try {
    const plans = await parse();
    clearSourceFailure(sourcePath);
    remember(plans);
    return plans;
  } catch (err) {
    reportSourceFailure(sourcePath, err);
    return undefined;
  }
}

function userPlanMetadata(): Record<string, unknown> {
  return { userCreated: true, userPlansDir: getUserPlansDir() };
}

function isUserPlanEntry(plan: Plan): boolean {
  return plan.metadata.userCreated === true;
}

/** One helper so full scans and per-file rescans attribute custom-dir plans identically. */
function customDirPlanMetadata(dir: string): Record<string, unknown> {
  const dirBasename =
    dir
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ?? 'custom';
  return { source: 'custom-dir', customDir: dir, agentHint: dirBasename };
}

function isCustomDirPlanEntry(plan: Plan): boolean {
  return plan.metadata.source === 'custom-dir';
}

/** Parse a generic markdown plan. Null when the file is gone; other read errors throw. */
async function parseGenericMarkdownPlan(
  filePath: string,
  extraMetadata: Record<string, unknown>,
): Promise<Plan | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const stats = await stat(filePath);

    let agent =
      (typeof extraMetadata.agentHint === 'string' ? extraMetadata.agentHint : '') || 'unknown';
    let metadata = extraMetadata;
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
    if (fmMatch) {
      const agentLine = fmMatch[1]?.match(/^agent:\s*(.+)$/m);
      if (agentLine?.[1]) agent = agentLine[1].trim();
      // Older CLI versions wrote the placeholder `latest` when the hook payload had no id.
      const sessionId = fmMatch[1]?.match(/^sessionId:\s*(.+)$/m)?.[1]?.trim();
      if (sessionId && sessionId !== 'latest')
        metadata = { ...extraMetadata, sessionId, sessionIdSource: 'frontmatter' };
    }

    const bodyContent = fmMatch ? content.slice(fmMatch[0].length) : content;
    const titleMatch = bodyContent.match(/^#\s+(.+)/m);
    // basename, not split('/'): on Windows filePath is backslash-separated, so
    // splitting on '/' yields the whole path and every heading-less plan was
    // titled with its full absolute path. It also strips `.md` as a suffix
    // rather than replacing the first occurrence anywhere in the name.
    const title = titleMatch?.[1]?.trim() || basename(filePath, '.md') || 'Untitled';

    return {
      id: hashPath(filePath),
      agent,
      title,
      content: bodyContent,
      filePath,
      format: 'md',
      createdAt: stats.birthtime,
      updatedAt: stats.mtime,
      metadata,
    };
  } catch (err) {
    if (isMissingSourceError(err)) return null;
    throw err;
  }
}

/** Shared state for one full scan: what it builds and what it falls back to. */
interface ScanContext {
  previous: Map<string, Plan>;
  next: Map<string, Plan>;
  nextCache: ParseCache;
  overrides: Record<string, string>;
}

/** Add a source's freshly parsed plans, or its previous plans when the read failed. */
function indexSourcePlans(
  context: ScanContext,
  sourcePath: string,
  plans: Plan[] | undefined,
  belongs: (plan: Plan) => boolean,
): number {
  const indexed = plans
    ? plans.map((plan) => preparePlanForIndex(plan, context.overrides))
    : plansForPath(context.previous, sourcePath, belongs);
  for (const plan of indexed) context.next.set(plan.id, plan);
  return indexed.length;
}

async function scanGenericMarkdownFile(
  context: ScanContext,
  file: string,
  metadata: Record<string, unknown>,
  belongs: (plan: Plan) => boolean,
): Promise<number> {
  const plans = await parseSourceForScan(
    file,
    `generic\0${JSON.stringify(metadata)}`,
    [file],
    async () => {
      const plan = await parseGenericMarkdownPlan(file, metadata);
      return plan ? [plan] : [];
    },
    context.nextCache,
  );
  return indexSourcePlans(context, file, plans, belongs);
}

async function scanUserPlans(context: ScanContext) {
  const userPlansDir = getUserPlansDir();
  if (!existsSync(userPlansDir)) return;
  const files = await walkDir(userPlansDir);
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    await scanGenericMarkdownFile(context, file, userPlanMetadata(), isUserPlanEntry);
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

async function scanCustomPlanDirs(coveredPaths: Set<string>, context: ScanContext) {
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
    try {
      if (!statSync(dir).isDirectory()) {
        console.log(`[agendex] skipping custom dir (not a directory): ${dir}`);
        continue;
      }
    } catch {
      console.log(`[agendex] skipping custom dir (inaccessible): ${dir}`);
      continue;
    }
    const files = await walkDir(dir);
    const metadata = customDirPlanMetadata(dir);
    let count = 0;
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      count += await scanGenericMarkdownFile(context, file, metadata, isCustomDirPlanEntry);
    }
    console.log(`[agendex] custom dir: ${dir} (${count} plans)`);
  }
}

let activeScan: Promise<void> | null = null;
let followUpScanRequested = false;

export interface ScanOptions {
  /** Passive polling can share an active traversal without extending the queue. */
  queueIfBusy?: boolean;
}

/**
 * True while `scanOnce` builds its replacement index. Rescans during that
 * window update the live (old) index so readers see them at once, and are
 * recorded so they can be replayed onto the new index after the swap instead
 * of being lost to a traversal that read the file before it changed.
 */
let scanInFlight = false;
const rescannedDuringScan = new Set<string>();

async function scanAdapterSource(
  context: ScanContext,
  adapter: AgentAdapter,
  sourcePath: string,
  scanRoot: string,
): Promise<void> {
  const plans = await parseSourceForScan(
    sourcePath,
    `adapter\0${adapter.agent}\0${scanRoot}`,
    getParseCacheDependencies(adapter, sourcePath),
    () => adapter.parse(sourcePath, scanRoot),
    context.nextCache,
  );
  indexSourcePlans(context, sourcePath, plans, (plan) => planBelongsToAdapter(plan, adapter));
}

async function scanOnce(): Promise<void> {
  scanInFlight = true;
  rescannedDuringScan.clear();
  let replay: string[];
  let adapterCount: number;
  try {
    clearPlanRepoRootCache();
    const adapters = getActiveAdapters();
    adapterCount = adapters.length;
    const adapterKey = adapters.map((adapter) => adapter.agent).join('\0');
    if (adapterKey !== parseCacheAdapterKey) {
      // Enabling or disabling adapters changes which adapter owns a source.
      parseCache = new Map();
      parseCacheAdapterKey = adapterKey;
    }
    const context: ScanContext = {
      previous: store,
      next: new Map(),
      nextCache: new Map(),
      overrides: loadValueOverrides(),
    };

    const coveredPaths = new Set<string>();
    for (const adapter of adapters) {
      const seenSources = new Set<string>();
      for (const searchPath of adapter.getSearchPaths()) {
        coveredPaths.add(canonicalPath(searchPath));
        const files = await walkDir(searchPath);
        for (const file of files) {
          if (!adapter.matches(file, searchPath)) continue;
          const sourcePath = adapter.getSourcePath?.(file) ?? file;
          const sourceKey = resolve(sourcePath);
          if (seenSources.has(sourceKey)) continue;
          seenSources.add(sourceKey);
          await scanAdapterSource(context, adapter, sourcePath, searchPath);
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
        const sourcePath = adapter.getSourcePath?.(file) ?? file;
        await scanAdapterSource(context, adapter, sourcePath, dir);
      }
      coveredPaths.add(resolvedDir);
      console.log(`[agendex] discovered project plans: ${dir}`);
    }

    await scanUserPlans(context);
    await scanCustomPlanDirs(coveredPaths, context);

    store = context.next;
    parseCache = context.nextCache;
    localValueOverrides = context.overrides;
    replay = [...rescannedDuringScan];
  } finally {
    scanInFlight = false;
    rescannedDuringScan.clear();
  }

  // Files that changed while the traversal ran may have been read before the
  // change; re-apply them to the new index (each reloads the overrides).
  for (const filePath of replay) await rescanFile(filePath);
  pruneDeletedValueOverrides(Object.keys(localValueOverrides));
  notifyPlansChanged();
  const indexableCount = getIndexablePlans().length;
  const hiddenCount = store.size - indexableCount;
  const hiddenSuffix = hiddenCount > 0 ? ` (${hiddenCount} hidden as low-value)` : '';
  console.log(
    `[agendex] indexed ${indexableCount} plans${hiddenSuffix} from ${adapterCount} adapters`,
  );
}

/**
 * Refresh the process-local plan index without allowing periodic polling,
 * watcher recovery, and API-triggered refreshes to traverse the same tree at
 * the same time. A request arriving during traversal queues one more pass so
 * route-triggered changes are visible before every waiting caller returns.
 */
export function scan(options: ScanOptions = {}): Promise<void> {
  if (activeScan) {
    if (options.queueIfBusy !== false) followUpScanRequested = true;
    return activeScan;
  }

  const drainScans = async (): Promise<void> => {
    do {
      followUpScanRequested = false;
      await scanOnce();
    } while (followUpScanRequested);
  };
  const pending = drainScans().finally(() => {
    if (activeScan === pending) {
      activeScan = null;
      followUpScanRequested = false;
    }
  });
  activeScan = pending;
  return pending;
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

/** Restore or return a locally indexed plan to automatic classification. Never modifies its source. */
export async function setPlanValueOverride(
  id: string,
  restore: boolean,
): Promise<Plan | undefined> {
  const plan = store.get(id);
  if (!plan) return undefined;
  overrideSourceMissingSince.delete(id);
  updateConfig((config) => {
    const planValueOverrides = { ...config?.planValueOverrides };
    if (restore) planValueOverrides[id] = resolve(plan.filePath);
    else delete planValueOverrides[id];
    return {
      ...(config ?? {
        configVersion: CURRENT_CONFIG_VERSION,
        enabledAdapters: [],
        customPlanDirs: [],
      }),
      planValueOverrides,
    };
  });
  // Queuing a fresh scan also prevents an already-running traversal from overwriting recovery.
  await scan();
  return store.get(id);
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
    filePath =
      adapter.getCreatePath?.(slug, timestamp) ??
      join(adapter.getSearchPaths()[0] ?? userPlansDir, filename);
    await mkdir(dirname(filePath), { recursive: true });
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

/** True when `plan` was derived from the file at the resolved path `normalized`. */
function planComesFromPath(plan: Plan, normalized: string): boolean {
  if (resolve(plan.filePath) === normalized) return true;
  const sessionPath =
    typeof plan.metadata.plannotator === 'object' && plan.metadata.plannotator !== null
      ? (plan.metadata.plannotator as Record<string, unknown>).sessionPath
      : undefined;
  if (sessionPath === normalized) return true;
  const sourcePaths = Array.isArray(plan.metadata.sourcePaths)
    ? plan.metadata.sourcePaths.filter((path): path is string => typeof path === 'string')
    : [];
  return sourcePaths.some((path) => resolve(path) === normalized);
}

function plansForPath(
  from: Map<string, Plan>,
  filePath: string,
  belongs: (plan: Plan) => boolean,
): Plan[] {
  const normalized = resolve(filePath);
  return [...from.values()].filter((plan) => planComesFromPath(plan, normalized) && belongs(plan));
}

function removePlansForPath(
  filePath: string,
  belongs: (plan: Plan) => boolean = () => true,
): Plan[] {
  const removed = plansForPath(store, filePath, belongs);
  for (const plan of removed) store.delete(plan.id);
  return removed;
}

/** Re-read one generic markdown plan (user plans dir or custom dir), removing it when deleted. */
async function rescanGenericMarkdownPlan(
  filePath: string,
  metadata: Record<string, unknown>,
  belongs: (plan: Plan) => boolean,
): Promise<Plan[]> {
  let plan: Plan | null;
  try {
    plan = await parseGenericMarkdownPlan(filePath, metadata);
    clearSourceFailure(filePath);
  } catch (err) {
    reportSourceFailure(filePath, err);
    return [];
  }
  if (!plan) {
    const removed = removePlansForPath(filePath, belongs);
    if (removed.length > 0) {
      pruneDeletedValueOverrides(removed.map((entry) => entry.id));
      notifyPlansChanged();
    }
    return removed;
  }
  const annotated = preparePlanForIndex(plan);
  store.set(annotated.id, annotated);
  notifyPlansChanged();
  return [annotated];
}

export async function rescanFile(filePath: string) {
  if (scanInFlight) rescannedDuringScan.add(filePath);
  localValueOverrides = loadValueOverrides();
  const adapters = getActiveAdapters();
  const normalized = resolve(filePath);
  pruneDeletedValueOverrides(
    Object.keys(localValueOverrides).filter((id) => localValueOverrides[id] === normalized),
  );
  const removedPlans: Plan[] = [];
  const discoveredPlanDirs = discoverProjectPlanDirs({ useCache: true });

  for (const adapter of adapters) {
    const discoveredDirs = discoveredPlanDirs
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

    const sourcePath = adapter.getSourcePath?.(filePath) ?? filePath;
    const belongs = (plan: Plan) => planBelongsToAdapter(plan, adapter);
    parseCache.delete(resolve(sourcePath));
    let rawPlans: Plan[];
    try {
      rawPlans = await adapter.parse(sourcePath, scanRoot);
      clearSourceFailure(sourcePath);
    } catch (err) {
      // The owning adapter could not read the source: keep what it had.
      reportSourceFailure(sourcePath, err);
      return [];
    }
    if (rawPlans.length === 0) {
      removedPlans.push(...removePlansForPath(sourcePath, belongs));
      continue;
    }
    removePlansForPath(sourcePath, belongs);
    const plans = rawPlans.map((plan) => preparePlanForIndex(plan));
    for (const plan of plans) {
      store.set(plan.id, plan);
    }
    notifyPlansChanged();
    return plans;
  }

  if (removedPlans.length > 0) {
    pruneDeletedValueOverrides(removedPlans.map((plan) => plan.id));
    notifyPlansChanged();
    return removedPlans;
  }

  if (!normalized.endsWith('.md')) return [];
  parseCache.delete(normalized);

  // Check user plans dir
  const userPlansDir = resolve(getUserPlansDir());
  if (normalized.startsWith(userPlansDir + sep)) {
    return rescanGenericMarkdownPlan(filePath, userPlanMetadata(), isUserPlanEntry);
  }

  // Check custom plan dirs
  for (const dir of getCustomPlanDirs()) {
    const resolvedDir = resolve(dir);
    if (normalized.startsWith(resolvedDir + sep)) {
      return rescanGenericMarkdownPlan(filePath, customDirPlanMetadata(dir), isCustomDirPlanEntry);
    }
  }

  return [];
}
