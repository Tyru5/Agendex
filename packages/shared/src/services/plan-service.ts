import { existsSync, readdirSync, statSync } from 'node:fs';
import { lstat, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { getActiveAdapters } from '../adapters/registry.ts';
import { getConfigDir, loadConfig } from '../config.ts';
import { hashPath } from '../hash.ts';
import type { Plan } from '../types.ts';

function getUserPlansDir(): string {
  return join(getConfigDir(), 'plans');
}

const store = new Map<string, Plan>();
const MAX_DEPTH = 6;
const DISCOVERY_MAX_DEPTH = 4;

const PROJECT_PLAN_MARKERS = [{ marker: '.sisyphus/plans', agent: 'oh-my-opencode' }];

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

export function discoverProjectPlanDirs(): DiscoveredPlanDir[] {
  const home = homedir();
  const results: DiscoveredPlanDir[] = [];

  function walk(dir: string, depth: number) {
    if (depth > DISCOVERY_MAX_DEPTH) return;

    for (const { marker, agent } of PROJECT_PLAN_MARKERS) {
      const candidate = join(dir, marker);
      if (existsSync(candidate)) {
        results.push({ dir: candidate, agent });
        return;
      }
    }

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
      } catch {}
    }
  }

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
      } catch {}
    }
  } catch {
    // permission denied or similar
  }
  return files;
}

async function parseGenericMarkdownPlan(
  filePath: string,
  extraMetadata: Record<string, unknown>,
): Promise<Plan | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const stats = await stat(filePath);

    let agent = 'unknown';
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

async function scanUserPlans() {
  const userPlansDir = getUserPlansDir();
  if (!existsSync(userPlansDir)) return;
  const files = await walkDir(userPlansDir);
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const plan = await parseGenericMarkdownPlan(file, { userCreated: true });
    if (plan) store.set(plan.id, plan);
  }
}

export function getCustomPlanDirs(): string[] {
  return loadConfig()?.customPlanDirs ?? [];
}

async function scanCustomPlanDirs(coveredPaths: Set<string>) {
  const dirs = getCustomPlanDirs();
  const userPlansDir = resolve(getUserPlansDir());
  for (const dir of dirs) {
    const resolved = resolve(dir);
    if (coveredPaths.has(resolved)) {
      console.log(`[agendex] skipping custom dir (already covered by adapter): ${dir}`);
      continue;
    }
    if (resolved.startsWith(userPlansDir + sep) || resolved === userPlansDir) {
      console.log(`[agendex] skipping custom dir (overlaps user plans): ${dir}`);
      continue;
    }
    if (!existsSync(dir)) {
      console.log(`[agendex] skipping custom dir (not found): ${dir}`);
      continue;
    }
    const files = await walkDir(dir);
    let count = 0;
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const plan = await parseGenericMarkdownPlan(file, {
        source: 'custom-dir',
        customDir: dir,
      });
      if (plan) {
        store.set(plan.id, plan);
        count++;
      }
    }
    console.log(`[agendex] custom dir: ${dir} (${count} plans)`);
  }
}

export async function scan() {
  const adapters = getActiveAdapters();
  store.clear();

  const coveredPaths = new Set<string>();
  for (const adapter of adapters) {
    for (const searchPath of adapter.getSearchPaths()) {
      coveredPaths.add(resolve(searchPath));
      const files = await walkDir(searchPath);
      for (const file of files) {
        if (!adapter.matches(file)) continue;
        const plans = await adapter.parse(file);
        for (const plan of plans) {
          store.set(plan.id, plan);
        }
      }
    }
  }

  const discovered = discoverProjectPlanDirs();
  for (const { dir, agent } of discovered) {
    if (coveredPaths.has(resolve(dir))) continue;
    const adapter = adapters.find((a) => a.agent === agent);
    if (!adapter) continue;
    const files = await walkDir(dir);
    for (const file of files) {
      if (!adapter.matches(file)) continue;
      const plans = await adapter.parse(file);
      for (const plan of plans) {
        store.set(plan.id, plan);
      }
    }
    console.log(`[agendex] discovered project plans: ${dir}`);
  }

  await scanUserPlans();
  await scanCustomPlanDirs(coveredPaths);
  notifyPlansChanged();
  console.log(`[agendex] indexed ${store.size} plans from ${adapters.length} adapters`);
}

export function getAll(): Plan[] {
  return Array.from(store.values());
}

export function getById(id: string): Plan | undefined {
  return store.get(id);
}

function isUserPlan(plan: Plan): boolean {
  return resolve(plan.filePath).startsWith(resolve(getUserPlansDir()) + sep);
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

  const adapters = getActiveAdapters();
  const adapter = adapters.find((a) => a.agent === plan.agent);
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

  store.set(plan.id, plan);
  notifyPlansChanged();
  return plan;
}

export function getAgentStats() {
  const adapters = getActiveAdapters();
  const stats = new Map<string, { count: number; writable: boolean }>();
  for (const adapter of adapters) {
    stats.set(adapter.agent, { count: 0, writable: adapter.writable });
  }
  for (const plan of store.values()) {
    const s = stats.get(plan.agent);
    if (s) s.count++;
  }
  return Array.from(stats.entries()).map(([agent, s]) => ({
    agent,
    planCount: s.count,
    writable: s.writable,
  }));
}

export async function rescanFile(filePath: string) {
  const adapters = getActiveAdapters();
  const normalized = resolve(filePath);

  for (const adapter of adapters) {
    if (!adapter.matches(filePath)) continue;

    const discoveredDirs = discoverProjectPlanDirs()
      .filter((d) => d.agent === adapter.agent)
      .map((d) => resolve(d.dir));

    const allSearchPaths = [
      ...adapter.getSearchPaths().map((sp) => resolve(sp)),
      ...discoveredDirs,
    ];

    const isInSearchPath = allSearchPaths.some(
      (sp) => normalized.startsWith(sp + sep) || normalized === sp,
    );

    if (!isInSearchPath) continue;

    const plans = await adapter.parse(filePath);
    for (const plan of plans) {
      store.set(plan.id, plan);
    }
    notifyPlansChanged();
    return plans;
  }

  // Check user plans dir
  const userPlansDir = resolve(getUserPlansDir());
  if (
    normalized.endsWith('.md') &&
    (normalized.startsWith(userPlansDir + sep) || normalized === userPlansDir)
  ) {
    const plan = await parseGenericMarkdownPlan(filePath, { userCreated: true });
    if (plan) {
      store.set(plan.id, plan);
      notifyPlansChanged();
      return [plan];
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
          store.set(plan.id, plan);
          notifyPlansChanged();
          return [plan];
        }
      }
    }
  }

  return [];
}
