import { isAbsolute, relative, resolve } from 'node:path';
import type { Plan, PlanFileMatch, PlanGitContext } from '@agendex/shared';
import { planAgentsMatch } from '@agendex/shared/plan-download-lookup';
import {
  type PlanReceipt,
  type PlanReceiptSummary,
  summarizePlanReceipt,
} from '@agendex/shared/receipts';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as z from 'zod';

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 50;
export const DEFAULT_MAX_CHARS = 60_000;
export const MAX_MAX_CHARS = 200_000;
const SNIPPET_BEFORE = 80;
const SNIPPET_LENGTH = 240;

/** Everything the handlers read, injected so tests don't need a real index or git. */
export interface McpToolProviders {
  /** Directory the server was launched from. */
  cwd: string;
  now(): number;
  /** Indexable plans; resolves once the initial scan has finished. */
  plans(): Promise<readonly Plan[]>;
  planById(id: string): Promise<Plan | undefined>;
  /** Relevance-ranked matches, best first. */
  search(plans: readonly Plan[], query: string): Plan[];
  receipts(plans: readonly Plan[]): Promise<Map<string, PlanReceipt>>;
  receipt(plan: Plan): Promise<PlanReceipt>;
  plansForFile(
    filePath: string,
    options: { cwd: string; plans: readonly Plan[] },
  ): Promise<PlanFileMatch[]>;
  /** Absolute directory with symlinks resolved when it exists. */
  canonicalDir(dir: string): string;
  /** Canonical git root containing a canonical directory, or null. */
  gitRoot(dir: string): string | null;
  /** Canonical git root of the plan's repository, or null. */
  planRepoRoot(plan: Plan): string | null;
  gitContext(plan: Plan): PlanGitContext | null;
}

export interface McpPlanSummary {
  id: string;
  title: string;
  agent: string;
  workspace: string | null;
  createdAt: string;
  updatedAt: string;
  receipt: PlanReceiptSummary | null;
}

export type McpScope =
  | { allWorkspaces: true }
  | { allWorkspaces: false; workspace: string; repoRoot: string | null };

const workspaceField = z
  .string()
  .optional()
  .describe(
    'Project directory to scope to. Defaults to the git root of the directory the server runs in.',
  );
const agentField = z
  .string()
  .optional()
  .describe('Only plans from this agent, e.g. "claude-code", "codex", "cursor".');
const limitField = z
  .number()
  .int()
  .optional()
  .describe(`Maximum results, 1-${MAX_LIMIT}. Default ${DEFAULT_LIMIT}.`);

export const searchPlansInput = {
  query: z
    .string()
    .describe('Words to search for. Every word must match; wrap a phrase in double quotes.'),
  workspace: workspaceField,
  agent: agentField,
  all_workspaces: z
    .boolean()
    .optional()
    .describe('Search plans from every project on this machine instead of one workspace.'),
  limit: limitField,
};

export const getPlanInput = {
  id: z.string().describe('Plan id from search_plans, recent_plans, or plans_for_file.'),
  max_chars: z
    .number()
    .int()
    .optional()
    .describe(
      `Maximum characters of plan markdown to return. Default ${DEFAULT_MAX_CHARS}, at most ${MAX_MAX_CHARS}.`,
    ),
};

export const plansForFileInput = {
  path: z
    .string()
    .describe('File path, absolute or relative to the workspace. A bare file name also works.'),
  workspace: z
    .string()
    .optional()
    .describe(
      'Directory relative paths resolve against. Defaults to the git root of the directory the server runs in.',
    ),
  limit: limitField,
};

export const recentPlansInput = {
  workspace: workspaceField,
  agent: agentField,
  since: z
    .string()
    .optional()
    .describe('Only plans updated at or after this time: an ISO 8601 date, or "24h", "7d", "2w".'),
  limit: limitField,
};

type Input<Shape extends z.ZodRawShape> = z.infer<z.ZodObject<Shape>>;
export type SearchPlansInput = Input<typeof searchPlansInput>;
export type GetPlanInput = Input<typeof getPlanInput>;
export type PlansForFileInput = Input<typeof plansForFileInput>;
export type RecentPlansInput = Input<typeof recentPlansInput>;

export const AGENDEX_MCP_INSTRUCTIONS =
  'Agendex indexes the plans coding agents (Claude Code, Codex, Cursor, and others) wrote on this machine, ' +
  'and checks git to show what happened after each plan: its receipt status is planned, in-progress, ' +
  'landed, stalled, or unavailable. Before planning or changing code, check what other agents already ' +
  'planned for the same area so you can build on it instead of redoing or contradicting it.';

export const AGENDEX_MCP_TOOL_DESCRIPTIONS = {
  search_plans:
    'Search plans other coding agents wrote, ranked by relevance. Call this before planning a ' +
    'feature or refactor in this repo to find earlier plans on the same topic and whether they ' +
    'landed. Scoped to the current repository unless you pass workspace or all_workspaces. ' +
    'Each result has a receipt summary: status (planned, in-progress, landed, stalled, ' +
    'unavailable), confidence, changed vs mentioned files, and commit count. Use get_plan for ' +
    'the full text.',
  get_plan:
    'Read one plan in full: its markdown, metadata (agent, workspace, file path, times, session, ' +
    'git) and its receipt (attributed commits, which mentioned files changed, were not touched, ' +
    'or are missing, and changes made outside the plan). Call this when a search result looks ' +
    'relevant, before building on or verifying that plan.',
  plans_for_file:
    'Find plans that mention a file or whose commits changed it, newest first. Call this before ' +
    'editing a file to see what other agents already planned for it and whether that work landed.',
  recent_plans:
    'List the most recently updated plans in this repo, newest first, with receipt summaries. ' +
    'Call this at the start of a task to catch up on what other agents planned lately.',
} as const;

export function toolResult(data: Record<string, unknown>): CallToolResult {
  return { structuredContent: data, content: [{ type: 'text', text: JSON.stringify(data) }] };
}

export function toolError(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)));
}

function clampMaxChars(maxChars: number | undefined): number {
  if (maxChars === undefined || !Number.isFinite(maxChars)) return DEFAULT_MAX_CHARS;
  return Math.min(MAX_MAX_CHARS, Math.max(1, Math.trunc(maxChars)));
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

const SINCE_UNIT_MS: Record<string, number> = { h: 3_600_000, d: 86_400_000, w: 604_800_000 };

/** Parses an ISO 8601 time or a relative `<n>h|d|w` window into epoch milliseconds. */
export function parseSince(value: string, now: number): number | undefined {
  const trimmed = value.trim();
  const relativeMatch = /^(\d+)\s*([hdw])$/i.exec(trimmed);
  const unitMs = relativeMatch?.[2] ? SINCE_UNIT_MS[relativeMatch[2].toLowerCase()] : undefined;
  if (relativeMatch && unitMs !== undefined) {
    return now - Number(relativeMatch[1]) * unitMs;
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function queryTerms(query: string): string[] {
  const terms: string[] = [];
  for (const match of query.toLowerCase().matchAll(/"([^"]*)(?:"|$)|([^\s"]+)/g)) {
    const term = (match[1] ?? match[2] ?? '').trim();
    if (term) terms.push(term);
  }
  return terms;
}

/** A short excerpt around the earliest content hit, or the start of the plan. */
export function buildSnippet(content: string, query: string): string {
  const lowered = content.toLowerCase();
  let hit = -1;
  for (const term of queryTerms(query)) {
    const index = lowered.indexOf(term);
    if (index !== -1 && (hit === -1 || index < hit)) hit = index;
  }
  const start = hit > SNIPPET_BEFORE ? hit - SNIPPET_BEFORE : 0;
  const end = Math.min(content.length, start + SNIPPET_LENGTH);
  const excerpt = content.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${excerpt}${end < content.length ? '…' : ''}`;
}

function stringMetadata(plan: Plan, key: string): string | undefined {
  const value = plan.metadata[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export interface McpToolHandlers {
  search_plans(input: SearchPlansInput): Promise<CallToolResult>;
  get_plan(input: GetPlanInput): Promise<CallToolResult>;
  plans_for_file(input: PlansForFileInput): Promise<CallToolResult>;
  recent_plans(input: RecentPlansInput): Promise<CallToolResult>;
}

export function createMcpToolHandlers(providers: McpToolProviders): McpToolHandlers {
  function resolveScope(workspace: string | undefined, allWorkspaces = false): McpScope {
    if (allWorkspaces) return { allWorkspaces: true };
    const cwd = providers.canonicalDir(providers.cwd);
    const dir = workspace?.trim()
      ? providers.canonicalDir(resolve(providers.cwd, workspace.trim()))
      : (providers.gitRoot(cwd) ?? cwd);
    return { allWorkspaces: false, workspace: dir, repoRoot: providers.gitRoot(dir) };
  }

  function inScope(plan: Plan, scope: McpScope): boolean {
    if (scope.allWorkspaces) return true;
    if (scope.repoRoot && providers.planRepoRoot(plan) === scope.repoRoot) return true;
    return Boolean(
      plan.workspace && isInside(providers.canonicalDir(plan.workspace), scope.workspace),
    );
  }

  function filterPlans(plans: readonly Plan[], scope: McpScope, agent: string | undefined): Plan[] {
    const requestedAgent = agent?.trim();
    return plans.filter(
      (plan) =>
        inScope(plan, scope) && (!requestedAgent || planAgentsMatch(plan.agent, requestedAgent)),
    );
  }

  async function receiptsFor(plans: readonly Plan[]): Promise<ReadonlyMap<string, PlanReceipt>> {
    return plans.length > 0 ? await providers.receipts(plans) : new Map();
  }

  function summaryOf(plan: Plan, receipts: ReadonlyMap<string, PlanReceipt>): McpPlanSummary {
    const receipt = receipts.get(plan.id);
    return {
      id: plan.id,
      title: plan.title,
      agent: plan.agent,
      workspace: plan.workspace ?? null,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
      receipt: receipt ? summarizePlanReceipt(receipt) : null,
    };
  }

  return {
    async search_plans(input: SearchPlansInput): Promise<CallToolResult> {
      const query = input.query.trim();
      if (!query) return toolError('query is empty. Pass one or more words to search for.');
      const scope = resolveScope(input.workspace, input.all_workspaces);
      const matches = providers.search(
        filterPlans(await providers.plans(), scope, input.agent),
        query,
      );
      const page = matches.slice(0, clampLimit(input.limit));
      const receipts = await receiptsFor(page);
      return toolResult({
        scope,
        total: matches.length,
        plans: page.map((plan) => ({
          ...summaryOf(plan, receipts),
          snippet: buildSnippet(plan.content, query),
        })),
      });
    },

    async get_plan(input: GetPlanInput): Promise<CallToolResult> {
      const plan = await providers.planById(input.id.trim());
      if (!plan) {
        return toolError(
          `No plan with id "${input.id}". Use search_plans, recent_plans, or plans_for_file to find plan ids.`,
        );
      }
      const maxChars = clampMaxChars(input.max_chars);
      const truncated = plan.content.length > maxChars;
      const receipt = await providers.receipt(plan);
      const sessionId = stringMetadata(plan, 'sessionId');
      const git = providers.gitContext(plan);
      return toolResult({
        id: plan.id,
        title: plan.title,
        agent: plan.agent,
        workspace: plan.workspace ?? null,
        filePath: plan.filePath,
        format: plan.format,
        createdAt: plan.createdAt.toISOString(),
        updatedAt: plan.updatedAt.toISOString(),
        ...(sessionId && { sessionId }),
        ...(git && { git }),
        totalChars: plan.content.length,
        truncated,
        ...(truncated && {
          notice: `Showing the first ${maxChars.toLocaleString('en-US')} of ${plan.content.length.toLocaleString('en-US')} characters. Call get_plan with a larger max_chars (up to ${MAX_MAX_CHARS.toLocaleString('en-US')}) to read more.`,
        }),
        content: truncated ? plan.content.slice(0, maxChars) : plan.content,
        receipt,
      });
    },

    async plans_for_file(input: PlansForFileInput): Promise<CallToolResult> {
      const filePath = input.path.trim();
      if (!filePath) return toolError('path is empty. Pass a file path or file name.');
      const scope = resolveScope(input.workspace);
      const cwd = scope.allWorkspaces ? providers.cwd : scope.workspace;
      const matches = await providers.plansForFile(filePath, {
        cwd,
        plans: await providers.plans(),
      });
      const page = matches.slice(0, clampLimit(input.limit));
      const receipts = await receiptsFor(page.map((match) => match.plan));
      return toolResult({
        path: filePath,
        cwd,
        total: matches.length,
        plans: page.map((match) => ({
          ...summaryOf(match.plan, receipts),
          mentioned: match.mentioned,
          changedByPlanCommits: match.changedByPlanCommits,
        })),
      });
    },

    async recent_plans(input: RecentPlansInput): Promise<CallToolResult> {
      let sinceMs: number | undefined;
      if (input.since?.trim()) {
        sinceMs = parseSince(input.since, providers.now());
        if (sinceMs === undefined) {
          return toolError(
            `Can't read since "${input.since}". Use an ISO 8601 date like 2026-09-01, or 24h, 7d, 2w.`,
          );
        }
      }
      const scope = resolveScope(input.workspace);
      const plans = filterPlans(await providers.plans(), scope, input.agent)
        .filter((plan) => sinceMs === undefined || plan.updatedAt.getTime() >= sinceMs)
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      const page = plans.slice(0, clampLimit(input.limit));
      const receipts = await receiptsFor(page);
      return toolResult({
        scope,
        ...(sinceMs !== undefined && { since: new Date(sinceMs).toISOString() }),
        total: plans.length,
        plans: page.map((plan) => summaryOf(plan, receipts)),
      });
    },
  };
}
