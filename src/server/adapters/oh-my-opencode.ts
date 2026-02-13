import { homedir } from 'os';
import { basename, join } from 'path';
import { readdirSync, existsSync, readFileSync } from 'fs';
import { stat, readdir, readFile, writeFile } from 'fs/promises';
import { createHash } from 'crypto';
import type { AgentAdapter, Plan } from './types.ts';

const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
const opencodeSessionDir = join(dataHome, 'opencode', 'storage', 'session');
const cwdPlansDir = join(process.cwd(), '.sisyphus', 'plans');
const PLAN_PATH_MARKER = '/.sisyphus/plans/';

interface SessionMeta {
  id?: string;
  parentID?: string;
  directory?: string;
}

function hashPath(filePath: string): string {
  return createHash('sha256').update(filePath).digest('hex').slice(0, 16);
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPlanMarkdown(filePath: string): boolean {
  const normalized = normalizePath(filePath).toLowerCase();
  return normalized.endsWith('.md') && normalized.includes(PLAN_PATH_MARKER);
}

function isSessionFile(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  const root = normalizePath(opencodeSessionDir);
  return normalized.startsWith(`${root}/`) && normalized.endsWith('.json');
}

function extractTitle(content: string, filePath: string): string {
  const heading = content.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/m)?.[1];
  if (heading) return heading.replace(/^Plan:\s*/i, '').trim();

  return basename(filePath, '.md')
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function workspaceFromPlanPath(filePath: string): string | undefined {
  const normalized = normalizePath(filePath);
  const lower = normalized.toLowerCase();
  const markerIndex = lower.lastIndexOf(PLAN_PATH_MARKER);
  if (markerIndex <= 0) return undefined;
  return normalized.slice(0, markerIndex);
}

function parseSessionMeta(raw: string): SessionMeta | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return undefined;
    return {
      id: typeof parsed.id === 'string' ? parsed.id : undefined,
      parentID: typeof parsed.parentID === 'string' ? parsed.parentID : undefined,
      directory: typeof parsed.directory === 'string' ? parsed.directory : undefined,
    };
  } catch {
    return undefined;
  }
}

function discoverPlanDirectories(): string[] {
  const dirs = new Set<string>([cwdPlansDir]);
  if (!existsSync(opencodeSessionDir)) return Array.from(dirs);

  try {
    const projectDirs = readdirSync(opencodeSessionDir, { withFileTypes: true });
    for (const projectDir of projectDirs) {
      if (!projectDir.isDirectory()) continue;

      const projectPath = join(opencodeSessionDir, projectDir.name);
      let sessionFiles: string[] = [];
      try {
        sessionFiles = readdirSync(projectPath);
      } catch {
        continue;
      }

      for (const file of sessionFiles) {
        if (!file.endsWith('.json')) continue;
        try {
          const raw = readFileSync(join(projectPath, file), 'utf-8');
          const session = parseSessionMeta(raw);
          if (!session?.directory) continue;
          if (session.parentID) continue;

          dirs.add(join(session.directory, '.sisyphus', 'plans'));
        } catch {
          continue;
        }
      }
    }
  } catch {
    // ignore path discovery failures and fall back to default paths
  }

  return Array.from(dirs);
}

async function parsePlanFile(
  filePath: string,
  workspace?: string,
  metadata: Record<string, unknown> = {},
): Promise<Plan[]> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const stats = await stat(filePath);
    return [
      {
        id: hashPath(filePath),
        agent: 'oh-my-opencode',
        title: extractTitle(content, filePath),
        content,
        filePath,
        format: 'md',
        createdAt: stats.birthtime,
        updatedAt: stats.mtime,
        workspace,
        metadata,
      },
    ];
  } catch {
    return [];
  }
}

async function parseSessionFile(filePath: string): Promise<Plan[]> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    const session = parseSessionMeta(raw);
    if (!session?.directory) return [];
    if (session.parentID) return [];

    const plansDir = join(session.directory, '.sisyphus', 'plans');
    if (!existsSync(plansDir)) return [];

    const entries = await readdir(plansDir, { withFileTypes: true });
    const plans: Plan[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const planPath = join(plansDir, entry.name);
      const parsed = await parsePlanFile(planPath, session.directory, {
        source: 'session-index',
        sessionId: session.id,
      });
      plans.push(...parsed);
    }

    return plans;
  } catch {
    return [];
  }
}

export const ohMyOpencodeAdapter: AgentAdapter = {
  agent: 'oh-my-opencode',
  writable: true,

  getSearchPaths() {
    return [opencodeSessionDir, ...discoverPlanDirectories()];
  },

  getWatchPaths() {
    return [opencodeSessionDir, ...discoverPlanDirectories()];
  },

  matches(filePath: string) {
    return isPlanMarkdown(filePath) || isSessionFile(filePath);
  },

  async parse(filePath: string): Promise<Plan[]> {
    if (isPlanMarkdown(filePath)) {
      return parsePlanFile(filePath, workspaceFromPlanPath(filePath), {
        source: 'plan-file',
      });
    }

    if (isSessionFile(filePath)) {
      return parseSessionFile(filePath);
    }

    return [];
  },

  async write(plan: Plan, newContent: string): Promise<boolean> {
    try {
      await writeFile(plan.filePath, newContent, 'utf-8');
      return true;
    } catch {
      return false;
    }
  },
};
