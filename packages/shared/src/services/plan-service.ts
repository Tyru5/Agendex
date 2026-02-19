import { existsSync } from 'node:fs';
import { lstat, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { getActiveAdapters } from '../adapters/registry.ts';
import { hashPath } from '../hash.ts';
import type { Plan } from '../types.ts';

const USER_PLANS_DIR = join(homedir(), '.agendex', 'plans');

const store = new Map<string, Plan>();
const MAX_DEPTH = 6;

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

async function scanUserPlans() {
  if (!existsSync(USER_PLANS_DIR)) return;
  const files = await walkDir(USER_PLANS_DIR);
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    try {
      const content = await readFile(file, 'utf-8');
      const stats = await stat(file);

      let agent = 'unknown';
      const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
      if (fmMatch) {
        const agentLine = fmMatch[1].match(/^agent:\s*(.+)$/m);
        if (agentLine) agent = agentLine[1].trim();
      }

      const bodyContent = fmMatch ? content.slice(fmMatch[0].length) : content;
      const titleMatch = bodyContent.match(/^#\s+(.+)/m);
      const title =
        titleMatch?.[1]?.trim() || file.split('/').pop()?.replace('.md', '') || 'Untitled';

      const plan: Plan = {
        id: hashPath(file),
        agent,
        title,
        content: bodyContent,
        filePath: file,
        format: 'md',
        createdAt: stats.birthtime,
        updatedAt: stats.mtime,
        metadata: { userCreated: true },
      };
      store.set(plan.id, plan);
    } catch {}
  }
}

export async function scan() {
  const adapters = getActiveAdapters();
  store.clear();
  for (const adapter of adapters) {
    for (const searchPath of adapter.getSearchPaths()) {
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
  await scanUserPlans();
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
  return resolve(plan.filePath).startsWith(resolve(USER_PLANS_DIR) + sep);
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

  if (adapter?.writable) {
    const dir = adapter.getSearchPaths()[0];
    await mkdir(dir, { recursive: true });
    filePath = join(dir, filename);
    fileContent = `# ${title}\n\n${content}`;
  } else {
    await mkdir(USER_PLANS_DIR, { recursive: true });
    filePath = join(USER_PLANS_DIR, filename);
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

    const isInSearchPath = adapter.getSearchPaths().some((sp) => {
      const searchNormalized = resolve(sp);
      return normalized.startsWith(searchNormalized + sep);
    });

    if (!isInSearchPath) continue;

    const plans = await adapter.parse(filePath);
    for (const plan of plans) {
      store.set(plan.id, plan);
    }
    notifyPlansChanged();
    return plans;
  }

  return [];
}
