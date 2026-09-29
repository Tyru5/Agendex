import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  collectWatchPaths,
  extractPlanGitContext,
  findGitRoot,
  findPlansForFile,
  getDefaultAdapterIds,
  getIndexableById,
  getIndexablePlans,
  getPlanGitContext,
  getPlanReceipt,
  getPlanReceipts,
  loadConfig,
  type Plan,
  resolveAdapters,
  resolvePlanRepoRoot,
  scan,
  searchPlans,
  setActiveAdapters,
  startWatching,
  stopWatchingForShutdown,
} from '@agendex/shared';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { resolveCliAdapterIds } from './adapters.ts';
import {
  DEFAULT_SYNC_RESCAN_INTERVAL_MS,
  DEFAULT_WATCHER_REFRESH_INTERVAL_MS,
  parseEnvMs,
} from './daemon-sync.ts';
import {
  AGENDEX_MCP_INSTRUCTIONS,
  AGENDEX_MCP_TOOL_DESCRIPTIONS,
  createMcpToolHandlers,
  getPlanInput,
  type McpToolProviders,
  plansForFileInput,
  recentPlansInput,
  searchPlansInput,
} from './mcp-tools.ts';
import { CLI_VERSION } from './version.ts';
import { createRetryableReadiness } from './mcp-readiness.ts';

/** Repo roots rarely change; re-resolve occasionally so new clones are picked up. */
const PATH_CACHE_TTL_MS = 60_000;

const READ_ONLY: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };

/**
 * Stdout carries JSON-RPC. Shared plan-service and watcher code log with
 * console.log, so send every stdout console method to stderr before anything runs.
 */
export function routeConsoleToStderr(): void {
  const toStderr = (...args: unknown[]) => console.error(...args);
  console.log = toStderr;
  console.info = toStderr;
  console.debug = toStderr;
}

function cachedByPath<T>(compute: (path: string) => T): (path: string) => T {
  const cache = new Map<string, { at: number; value: T }>();
  return (path) => {
    const now = Date.now();
    const hit = cache.get(path);
    if (hit && now - hit.at < PATH_CACHE_TTL_MS) return hit.value;
    const value = compute(path);
    cache.set(path, { at: now, value });
    return value;
  };
}

function createIndexProviders(ready: () => Promise<void>, cwd: string): McpToolProviders {
  const canonicalDir = cachedByPath((dir) => {
    const absolute = resolve(dir);
    try {
      return realpathSync(absolute);
    } catch {
      return absolute;
    }
  });
  const gitRoot = cachedByPath((dir) => {
    const root = findGitRoot(dir);
    return root ? canonicalDir(root) : null;
  });
  const repoRootByStartDir = cachedByPath((startDir) => {
    const root = resolvePlanRepoRoot({ workspace: startDir });
    return root ? canonicalDir(root) : null;
  });

  return {
    cwd,
    now: Date.now,
    plans: async () => {
      await ready();
      return getIndexablePlans();
    },
    planById: async (id) => {
      await ready();
      return getIndexableById(id);
    },
    search: searchPlans,
    receipts: getPlanReceipts,
    receipt: getPlanReceipt,
    plansForFile: findPlansForFile,
    canonicalDir,
    gitRoot,
    planRepoRoot: (plan: Plan) => {
      // Same precedence as resolvePlanRepoRoot: workspace first, then the artifact's directory.
      const fromWorkspace = plan.workspace ? repoRootByStartDir(plan.workspace) : null;
      return fromWorkspace ?? repoRootByStartDir(dirname(resolve(plan.filePath)));
    },
    gitContext: (plan) => extractPlanGitContext(plan.metadata) ?? getPlanGitContext(plan),
  };
}

/**
 * `agendex mcp [--workspace <dir>]`: a read-only MCP server over stdio backed
 * by an in-process plan index. Answers `initialize`/`tools/list` right away;
 * tool calls wait for the first scan. `--workspace` pins the default scope for
 * clients that don't start servers in the project directory. Resolves once the
 * client disconnects or a signal arrives.
 */
export async function runMcpServer(args: string[]): Promise<number> {
  routeConsoleToStderr();

  const workspaceIndex = args.indexOf('--workspace');
  const workspace = workspaceIndex === -1 ? undefined : args[workspaceIndex + 1];
  if (workspaceIndex !== -1 && (!workspace || workspace.startsWith('--'))) {
    console.error('[agendex] usage: agendex mcp [--workspace <dir>]');
    return 1;
  }
  const cwd = workspace ? resolve(workspace) : process.cwd();
  if (workspace) {
    // Project-local adapters discover from the working directory, so the
    // override has to govern indexing as well as result scoping.
    try {
      process.chdir(cwd);
    } catch {
      console.error(`[agendex] --workspace must be an existing directory: ${cwd}`);
      return 1;
    }
  }

  const config = loadConfig();
  setActiveAdapters(
    resolveAdapters(config ? resolveCliAdapterIds(config) : getDefaultAdapterIds()),
  );
  const stopTimers: Array<() => void> = [];
  const every = (ms: number, tick: () => void) => {
    if (ms <= 0) return;
    const id = setInterval(tick, ms);
    id.unref();
    stopTimers.push(() => clearInterval(id));
  };
  const ready = createRetryableReadiness(async () => {
    await scan();
    startWatching();
    // Same safety net as the daemon: pick up plan directories created after
    // launch and sources the watcher doesn't cover (e.g. the hook spool).
    every(parseEnvMs('AGENDEX_SYNC_RESCAN_INTERVAL_MS', DEFAULT_SYNC_RESCAN_INTERVAL_MS), () => {
      void scan({ queueIfBusy: false }).catch(() => {});
    });
    let watchKey = collectWatchPaths().join('\0');
    every(
      parseEnvMs('AGENDEX_WATCHER_REFRESH_INTERVAL_MS', DEFAULT_WATCHER_REFRESH_INTERVAL_MS),
      () => {
        const nextKey = collectWatchPaths().join('\0');
        if (nextKey === watchKey) return;
        watchKey = nextKey;
        startWatching();
      },
    );
  });
  // Report this attempt's failure. A later tool call retries initialization rather
  // than serving an incomplete index or retaining a permanently rejected promise.
  void ready().catch((err: unknown) => {
    console.error(
      `[agendex] initial scan failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  });

  const handlers = createMcpToolHandlers(createIndexProviders(ready, cwd));
  const server = new McpServer(
    { name: 'agendex', version: CLI_VERSION },
    { instructions: AGENDEX_MCP_INSTRUCTIONS },
  );
  server.registerTool(
    'search_plans',
    {
      title: 'Search plans',
      description: AGENDEX_MCP_TOOL_DESCRIPTIONS.search_plans,
      inputSchema: searchPlansInput,
      annotations: READ_ONLY,
    },
    (input) => handlers.search_plans(input),
  );
  server.registerTool(
    'get_plan',
    {
      title: 'Get plan',
      description: AGENDEX_MCP_TOOL_DESCRIPTIONS.get_plan,
      inputSchema: getPlanInput,
      annotations: READ_ONLY,
    },
    (input) => handlers.get_plan(input),
  );
  server.registerTool(
    'plans_for_file',
    {
      title: 'Plans for file',
      description: AGENDEX_MCP_TOOL_DESCRIPTIONS.plans_for_file,
      inputSchema: plansForFileInput,
      annotations: READ_ONLY,
    },
    (input) => handlers.plans_for_file(input),
  );
  server.registerTool(
    'recent_plans',
    {
      title: 'Recent plans',
      description: AGENDEX_MCP_TOOL_DESCRIPTIONS.recent_plans,
      inputSchema: recentPlansInput,
      annotations: READ_ONLY,
    },
    (input) => handlers.recent_plans(input),
  );

  const closed = new Promise<void>((resolveClosed) => {
    const done = () => resolveClosed();
    server.server.onclose = done;
    process.stdin.once('end', done);
    process.stdin.once('close', done);
    process.once('SIGINT', done);
    process.once('SIGTERM', done);
  });
  await server.connect(new StdioServerTransport());
  await closed;

  for (const stop of stopTimers) stop();
  stopWatchingForShutdown();
  await server.close().catch(() => {});
  return 0;
}
