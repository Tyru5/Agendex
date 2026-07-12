import { computePlanSyncIdentity, exactDuplicateKey } from '@agendex/shared/plan-sync-identity';
import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { internalMutation, internalQuery } from './_generated/server';
import { deletePlanRelatedData } from './planDeletion';
import {
  assessPlanForVisibility,
  hasLowValueMetadata,
  metadataWithPlanValueAssessment,
} from './planVisibility';

const DEFAULT_BATCH_SIZE = 200;
const MAX_BATCH_SIZE = 500;
const MAX_EXAMPLES = 25;
const ADMIN_TOKEN_ENV = 'PLAN_CLEANUP_ADMIN_TOKEN';

type LowValuePlanReport = {
  lowValue: boolean;
  reasons: string[];
  signals: string[];
};

type PlanCleanupSummary = {
  scanned: number;
  lowValue: number;
  byReason: Record<string, number>;
  byAgent: Record<string, number>;
  bySource: Record<string, number>;
  examples: Array<{
    planId: string;
    localPlanId?: string;
    title: string;
    agent: string;
    source: string;
    contentLength: number;
    reasons: string[];
  }>;
};

function requireAdminToken(token: string) {
  const expected = process.env[ADMIN_TOKEN_ENV];
  if (!expected) throw new ConvexError(`${ADMIN_TOKEN_ENV} is not configured`);
  if (token !== expected) throw new ConvexError('Invalid cleanup admin token');
}

function batchSize(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) return DEFAULT_BATCH_SIZE;
  return Math.max(1, Math.min(Math.floor(limit), MAX_BATCH_SIZE));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sourceForPlan(plan: Doc<'plans'>): string {
  const metadata = plan.metadata;
  if (!isRecord(metadata)) return 'none';
  const source = metadata.source ?? metadata.sourceAdapter;
  return typeof source === 'string' && source.trim() ? source : 'none';
}

function increment(target: Record<string, number>, key: string) {
  target[key] = (target[key] ?? 0) + 1;
}

function classifyPlan(plan: Doc<'plans'>): LowValuePlanReport {
  const assessment = assessPlanForVisibility(plan);
  const metadataLowValue = hasLowValueMetadata(plan.metadata);
  const reasons: string[] = [...assessment.reasons];
  const signals: string[] = [...assessment.signals];

  if (metadataLowValue) {
    reasons.unshift('metadata-low-value');
    signals.unshift('metadata:low-value');
  }

  return {
    lowValue: metadataLowValue || assessment.lowValue,
    reasons: Array.from(new Set(reasons)),
    signals: Array.from(new Set(signals)),
  };
}

function emptySummary(): PlanCleanupSummary {
  return {
    scanned: 0,
    lowValue: 0,
    byReason: {},
    byAgent: {},
    bySource: {},
    examples: [],
  };
}

function addToSummary(summary: PlanCleanupSummary, plan: Doc<'plans'>, report: LowValuePlanReport) {
  summary.scanned++;
  if (!report.lowValue) return;

  summary.lowValue++;
  increment(summary.byAgent, plan.agent || 'unknown');
  increment(summary.bySource, sourceForPlan(plan));
  for (const reason of report.reasons) increment(summary.byReason, reason);

  if (summary.examples.length < MAX_EXAMPLES) {
    summary.examples.push({
      planId: String(plan._id),
      localPlanId: plan.localPlanId,
      title: plan.title.slice(0, 120),
      agent: plan.agent,
      source: sourceForPlan(plan),
      contentLength: plan.content.length,
      reasons: report.reasons,
    });
  }
}

const cleanupArgs = {
  adminToken: v.string(),
  cursor: v.optional(v.union(v.string(), v.null())),
  limit: v.optional(v.number()),
};

// Internal-only: this performs irreversible deletes (cleanupLowValuePlans) and
// must never be reachable from the public client API, regardless of the admin
// token check below. Invoke via `npx convex run` (authenticated deploy access)
// or the Convex dashboard.
export const auditLowValuePlans = internalQuery({
  args: cleanupArgs,
  handler: async (ctx, args) => {
    requireAdminToken(args.adminToken);

    const result = await ctx.db.query('plans').paginate({
      cursor: args.cursor ?? null,
      numItems: batchSize(args.limit),
    });

    const summary = emptySummary();
    for (const plan of result.page) {
      addToSummary(summary, plan, classifyPlan(plan));
    }

    return {
      mode: 'dry-run' as const,
      ...summary,
      isDone: result.isDone,
      continueCursor: result.isDone ? null : result.continueCursor,
    };
  },
});

export const cleanupLowValuePlans = internalMutation({
  args: cleanupArgs,
  handler: async (ctx, args) => {
    requireAdminToken(args.adminToken);

    const result = await ctx.db.query('plans').paginate({
      cursor: args.cursor ?? null,
      numItems: batchSize(args.limit),
    });

    const summary = emptySummary();
    let deleted = 0;
    for (const plan of result.page) {
      const report = classifyPlan(plan);
      addToSummary(summary, plan, report);
      if (!report.lowValue) continue;

      await deletePlanRelatedData(ctx, { planId: plan._id, ownerId: plan.ownerId });
      await ctx.db.delete(plan._id);
      deleted++;
    }

    // Deleting rows from the page just paginated can shift table position out
    // from under `continueCursor`, which is computed against the pre-delete
    // table state. When that happens, re-scan from this call's starting cursor
    // instead of advancing, so the next batch can't skip over rows that moved
    // into the deleted rows' place.
    const advance = deleted === 0;

    return {
      mode: 'apply' as const,
      ...summary,
      deleted,
      isDone: advance && result.isDone,
      continueCursor: advance
        ? result.isDone
          ? null
          : result.continueCursor
        : (args.cursor ?? null),
    };
  },
});

// Only the persisted low-value keys can change when re-assessing a plan
// (`metadataWithPlanValueAssessment` preserves every other metadata field), so
// comparing just those keys tells us whether a rewrite is actually needed.
function lowValueVerdictChanged(before: unknown, after: unknown): boolean {
  const b = isRecord(before) ? before : {};
  const a = isRecord(after) ? after : {};
  return (
    (b.lowValue === true) !== (a.lowValue === true) ||
    JSON.stringify(b.lowValueReasons ?? null) !== JSON.stringify(a.lowValueReasons ?? null) ||
    JSON.stringify(b.lowValueSignals ?? null) !== JSON.stringify(a.lowValueSignals ?? null)
  );
}

type BackfillResult = {
  mode: 'backfill';
  scanned: number;
  updated: number;
  isDone: boolean;
  continueCursor: string | null;
};

type SyncIdentityBackfillResult = {
  mode: 'sync-identity-backfill';
  scanned: number;
  updated: number;
  isDone: boolean;
  continueCursor: string | null;
};

type DuplicateAuditGroup = {
  key: string;
  count: number;
  canonicalPlanId: string;
  planIds: string[];
};

// Re-stamp every plan's persisted low-value flag so it reflects the CURRENT
// classifier, then let collection reads trust that flag instead of classifying
// live (see `filterVisiblePlans`). Run once after any change to the
// `plan-value` classifier. Self-schedules through every page unless invoked
// with `continue: false` (single-batch mode). Internal-only: drive via
// `npx convex run planCleanup:backfillPlanValueMetadata` or the dashboard.
export const backfillPlanValueMetadata = internalMutation({
  args: {
    adminToken: v.string(),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
    continue: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<BackfillResult> => {
    requireAdminToken(args.adminToken);

    const result = await ctx.db.query('plans').paginate({
      cursor: args.cursor ?? null,
      numItems: batchSize(args.limit),
    });

    let updated = 0;
    for (const plan of result.page) {
      const nextMetadata = metadataWithPlanValueAssessment(plan.metadata, {
        title: plan.title,
        content: plan.content,
      });
      if (lowValueVerdictChanged(plan.metadata, nextMetadata)) {
        // `metadata` is optional; patching `undefined` clears a now-stale flag.
        await ctx.db.patch(plan._id, { metadata: nextMetadata });
        updated++;
      }
    }

    // Patches never remove rows, so `continueCursor` (computed against the
    // just-read page) stays valid — unlike the delete path above, it's always
    // safe to advance.
    if (!result.isDone && args.continue !== false) {
      await ctx.scheduler.runAfter(0, internal.planCleanup.backfillPlanValueMetadata, {
        adminToken: args.adminToken,
        cursor: result.continueCursor,
        limit: args.limit,
        continue: args.continue,
      });
    }

    return {
      mode: 'backfill',
      scanned: result.page.length,
      updated,
      isDone: result.isDone,
      continueCursor: result.isDone ? null : result.continueCursor,
    };
  },
});

function syncIdentityPatch(plan: Doc<'plans'>) {
  const identity = computePlanSyncIdentity({
    agent: plan.agent,
    title: plan.title,
    content: plan.content,
    format: plan.format,
    filePath: plan.filePath,
    workspace: plan.workspace,
    metadata: plan.metadata,
  });

  return {
    syncIdentityKey: identity.syncIdentityKey,
    contentHash: identity.contentHash,
    identityVersion: identity.identityVersion,
    identityStrength: identity.identityStrength,
  };
}

function syncDuplicateKey(plan: Doc<'plans'>): string {
  if (plan.syncIdentityKey) return `sync:${plan.syncIdentityKey}`;
  const contentHash = plan.contentHash ?? computePlanSyncIdentity(plan).contentHash;
  return `exact:${exactDuplicateKey({ agent: plan.agent, title: plan.title, contentHash })}`;
}

function duplicateWinner(plans: Doc<'plans'>[]): Doc<'plans'> {
  return plans.reduce((winner, plan) => {
    if (plan.updatedAt !== winner.updatedAt)
      return plan.updatedAt > winner.updatedAt ? plan : winner;
    return plan._creationTime > winner._creationTime ? plan : winner;
  });
}

export const backfillPlanSyncIdentity = internalMutation({
  args: {
    adminToken: v.string(),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
    continue: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<SyncIdentityBackfillResult> => {
    requireAdminToken(args.adminToken);

    const result = await ctx.db.query('plans').paginate({
      cursor: args.cursor ?? null,
      numItems: batchSize(args.limit),
    });

    let updated = 0;
    for (const plan of result.page) {
      const patch = syncIdentityPatch(plan);
      if (
        plan.syncIdentityKey === patch.syncIdentityKey &&
        plan.contentHash === patch.contentHash &&
        plan.identityVersion === patch.identityVersion &&
        plan.identityStrength === patch.identityStrength
      ) {
        continue;
      }
      await ctx.db.patch(plan._id, patch);
      updated++;
    }

    if (!result.isDone && args.continue !== false) {
      await ctx.scheduler.runAfter(0, internal.planCleanup.backfillPlanSyncIdentity, {
        adminToken: args.adminToken,
        cursor: result.continueCursor,
        limit: args.limit,
        continue: args.continue,
      });
    }

    return {
      mode: 'sync-identity-backfill',
      scanned: result.page.length,
      updated,
      isDone: result.isDone,
      continueCursor: result.isDone ? null : result.continueCursor,
    };
  },
});

export const auditDuplicatePlanSyncIdentities = internalQuery({
  args: cleanupArgs,
  handler: async (ctx, args) => {
    requireAdminToken(args.adminToken);

    const result = await ctx.db.query('plans').paginate({
      cursor: args.cursor ?? null,
      numItems: batchSize(args.limit),
    });

    const byKey = new Map<string, Doc<'plans'>[]>();
    for (const plan of result.page) {
      const key = syncDuplicateKey(plan);
      const group = byKey.get(key) ?? [];
      group.push(plan);
      byKey.set(key, group);
    }

    const duplicateGroups: DuplicateAuditGroup[] = [];
    for (const [key, group] of byKey) {
      if (group.length < 2) continue;
      const canonical = duplicateWinner(group);
      duplicateGroups.push({
        key,
        count: group.length,
        canonicalPlanId: String(canonical._id),
        planIds: group.map((plan) => String(plan._id)),
      });
    }

    return {
      mode: 'duplicate-sync-dry-run' as const,
      scanned: result.page.length,
      duplicateGroups,
      isDone: result.isDone,
      continueCursor: result.isDone ? null : result.continueCursor,
    };
  },
});

// ---------------------------------------------------------------------------
// Codex multi-agent subagent / same-title clone cleanup
//
// Codex writes one rollout file per subagent thread. Before the adapter skipped
// those threads, each child synced as its own cloud plan — often with the same
// parent user title. Historical rows may lack subagent metadata, so cleanup
// supports:
//   1. Explicit subagent signals on metadata
//   2. Optional titleContains filter (e.g. "drawing board") with keepPlanId
//   3. Optional owner-scoped title-family dedupe for codex session rollouts
// ---------------------------------------------------------------------------

const CODEX_AGENTS = new Set(['codex-cli', 'codex']);
const MAX_OWNER_SCAN = 2_000;

function normalizedPlanTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim().toLowerCase();
}

function isCodexAgent(agent: string): boolean {
  return CODEX_AGENTS.has(agent.trim().toLowerCase());
}

function isCodexSessionRollout(plan: Doc<'plans'>): boolean {
  if (!isCodexAgent(plan.agent)) return false;
  if (plan.format === 'jsonl') return true;
  const path = plan.filePath ?? '';
  return path.includes('/.codex/sessions/') || /(?:^|\/)rollout-.*\.jsonl$/i.test(path);
}

/**
 * True when metadata (or path-coupled fields) prove this row is a multi-agent
 * child thread rather than a user plan session.
 */
function hasExplicitCodexSubagentSignals(plan: Doc<'plans'>): boolean {
  if (!isCodexAgent(plan.agent)) return false;
  const metadata = isRecord(plan.metadata) ? plan.metadata : {};

  if (metadata.threadSource === 'subagent' || metadata.thread_source === 'subagent') return true;

  const parentThreadId =
    stringField(metadata.parentThreadId) ?? stringField(metadata.parent_thread_id);
  const sessionId = stringField(metadata.sessionId) ?? stringField(metadata.session_id);
  if (parentThreadId && (!sessionId || parentThreadId !== sessionId)) return true;

  // Subagent-only fields written by newer adapters / future backfills.
  if (stringField(metadata.agentNickname) || stringField(metadata.agent_nickname)) return true;
  if (stringField(metadata.agentRole) || stringField(metadata.agent_role)) return true;

  return false;
}

function stringField(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function titleMatchesFilter(title: string, titleContains: string | undefined): boolean {
  if (!titleContains) return true;
  return title.toLowerCase().includes(titleContains.trim().toLowerCase());
}

type CodexSubagentMatchReason = 'explicit-subagent-metadata' | 'title-family-duplicate';

type CodexSubagentExample = {
  planId: string;
  localPlanId?: string;
  ownerId: string;
  title: string;
  agent: string;
  filePath?: string;
  contentLength: number;
  reasons: CodexSubagentMatchReason[];
  sessionId?: string;
  parentThreadId?: string;
};

type CodexSubagentCleanupSummary = {
  scanned: number;
  matched: number;
  byReason: Record<string, number>;
  examples: CodexSubagentExample[];
};

function emptyCodexSubagentSummary(): CodexSubagentCleanupSummary {
  return { scanned: 0, matched: 0, byReason: {}, examples: [] };
}

function addCodexSubagentExample(
  summary: CodexSubagentCleanupSummary,
  plan: Doc<'plans'>,
  reasons: CodexSubagentMatchReason[],
) {
  summary.matched++;
  for (const reason of reasons) increment(summary.byReason, reason);
  if (summary.examples.length >= MAX_EXAMPLES) return;

  const metadata = isRecord(plan.metadata) ? plan.metadata : {};
  summary.examples.push({
    planId: String(plan._id),
    localPlanId: plan.localPlanId,
    ownerId: plan.ownerId,
    title: plan.title.slice(0, 120),
    agent: plan.agent,
    filePath: plan.filePath,
    contentLength: plan.content.length,
    reasons,
    sessionId: stringField(metadata.sessionId) ?? stringField(metadata.session_id),
    parentThreadId: stringField(metadata.parentThreadId) ?? stringField(metadata.parent_thread_id),
  });
}

function titleFamilyWinner(group: Doc<'plans'>[], keepPlanId: string | undefined): Doc<'plans'> {
  if (keepPlanId) {
    const kept = group.find((plan) => String(plan._id) === keepPlanId);
    if (kept) return kept;
  }

  // Prefer rows that do *not* look like subagents, then earliest creation
  // (parent session usually lands first), then longest content, then newest update.
  return group.reduce((winner, plan) => {
    const planSub = hasExplicitCodexSubagentSignals(plan);
    const winSub = hasExplicitCodexSubagentSignals(winner);
    if (planSub !== winSub) return planSub ? winner : plan;
    if (plan.createdAt !== winner.createdAt) {
      return plan.createdAt < winner.createdAt ? plan : winner;
    }
    if (plan.content.length !== winner.content.length) {
      return plan.content.length > winner.content.length ? plan : winner;
    }
    return plan.updatedAt >= winner.updatedAt ? plan : winner;
  });
}

const codexSubagentCleanupArgs = {
  adminToken: v.string(),
  cursor: v.optional(v.union(v.string(), v.null())),
  limit: v.optional(v.number()),
  /** Case-insensitive substring match against plan.title. */
  titleContains: v.optional(v.string()),
  /**
   * Never delete this plan id (string form of Id<'plans'>). Validated at
   * runtime rather than via v.id('plans') so dry-runs can target a prod id
   * without failing validation on another deployment.
   */
  keepPlanId: v.optional(v.string()),
  /**
   * When true *and* titleContains is set, for each owner seen on the page load
   * their recent codex session plans and delete same-title siblings matching
   * the filter (keeping one winner per title). Requires titleContains so we
   * don't collapse unrelated same-prompt sessions globally.
   */
  dedupeTitleFamilies: v.optional(v.boolean()),
  /** Minimum group size for title-family dedupe (default 2). */
  minTitleFamilySize: v.optional(v.number()),
  continue: v.optional(v.boolean()),
};

/**
 * Decide whether a single plan should be removed via *standalone* signals
 * (explicit subagent metadata). Title-family membership is handled separately
 * so we only delete non-winners of a group.
 */
function matchStandaloneCodexSubagentPlan(
  plan: Doc<'plans'>,
  args: { keepPlanId?: string },
): CodexSubagentMatchReason[] | null {
  if (args.keepPlanId && String(plan._id) === args.keepPlanId) return null;
  if (!isCodexAgent(plan.agent)) return null;

  if (hasExplicitCodexSubagentSignals(plan)) {
    return ['explicit-subagent-metadata'];
  }

  return null;
}

function minTitleFamilySize(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return 2;
  return Math.max(2, Math.floor(value));
}

function shouldDedupeTitleFamilies(args: {
  dedupeTitleFamilies?: boolean;
  titleContains?: string;
}): boolean {
  // Title-family collapse requires an explicit title scope so we never wipe
  // every repeated prompt (AGENTS.md generators, review templates, etc.).
  // Setting titleContains alone is enough — dedupeTitleFamilies defaults on
  // in that case; pass dedupeTitleFamilies:false to disable.
  if (!args.titleContains?.trim()) return false;
  if (args.dedupeTitleFamilies === false) return false;
  return true;
}

export const auditCodexSubagentPlans = internalQuery({
  args: codexSubagentCleanupArgs,
  handler: async (ctx, args) => {
    requireAdminToken(args.adminToken);

    const result = await ctx.db.query('plans').paginate({
      cursor: args.cursor ?? null,
      numItems: batchSize(args.limit),
    });

    const summary = emptyCodexSubagentSummary();
    const keepPlanId = args.keepPlanId?.trim() || undefined;
    const matchedIds = new Set<string>();
    const familyMin = minTitleFamilySize(args.minTitleFamilySize);

    for (const plan of result.page) {
      summary.scanned++;
      const reasons = matchStandaloneCodexSubagentPlan(plan, { keepPlanId });
      if (!reasons) continue;
      matchedIds.add(String(plan._id));
      addCodexSubagentExample(summary, plan, reasons);
    }

    // Title-family pass (owner-scoped) for historical clones without subagent
    // metadata. Requires titleContains — see shouldDedupeTitleFamilies.
    if (shouldDedupeTitleFamilies(args)) {
      const owners = new Set(result.page.map((plan) => plan.ownerId));
      for (const ownerId of owners) {
        const ownerPlans = await ctx.db
          .query('plans')
          .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
          .order('desc')
          .take(MAX_OWNER_SCAN);

        const byTitle = new Map<string, Doc<'plans'>[]>();
        for (const plan of ownerPlans) {
          if (!isCodexSessionRollout(plan)) continue;
          if (!titleMatchesFilter(plan.title, args.titleContains)) continue;
          const key = normalizedPlanTitle(plan.title);
          if (!key) continue;
          const group = byTitle.get(key) ?? [];
          group.push(plan);
          byTitle.set(key, group);
        }

        for (const group of byTitle.values()) {
          if (group.length < familyMin) continue;
          const winner = titleFamilyWinner(group, keepPlanId);
          for (const plan of group) {
            if (plan._id === winner._id) continue;
            const id = String(plan._id);
            if (matchedIds.has(id)) continue;
            matchedIds.add(id);
            addCodexSubagentExample(summary, plan, ['title-family-duplicate']);
          }
        }
      }
    }

    return {
      mode: 'codex-subagent-dry-run' as const,
      ...summary,
      isDone: result.isDone,
      continueCursor: result.isDone ? null : result.continueCursor,
    };
  },
});

export const cleanupCodexSubagentPlans = internalMutation({
  args: codexSubagentCleanupArgs,
  handler: async (ctx, args) => {
    requireAdminToken(args.adminToken);

    const result = await ctx.db.query('plans').paginate({
      cursor: args.cursor ?? null,
      numItems: batchSize(args.limit),
    });

    const summary = emptyCodexSubagentSummary();
    const keepPlanId = args.keepPlanId?.trim() || undefined;
    const familyMin = minTitleFamilySize(args.minTitleFamilySize);
    const toDelete = new Map<string, { plan: Doc<'plans'>; reasons: CodexSubagentMatchReason[] }>();

    for (const plan of result.page) {
      summary.scanned++;
      const reasons = matchStandaloneCodexSubagentPlan(plan, { keepPlanId });
      if (!reasons) continue;
      toDelete.set(String(plan._id), { plan, reasons });
    }

    if (shouldDedupeTitleFamilies(args)) {
      const owners = new Set(result.page.map((plan) => plan.ownerId));
      for (const ownerId of owners) {
        const ownerPlans = await ctx.db
          .query('plans')
          .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
          .order('desc')
          .take(MAX_OWNER_SCAN);

        const byTitle = new Map<string, Doc<'plans'>[]>();
        for (const plan of ownerPlans) {
          if (!isCodexSessionRollout(plan)) continue;
          if (!titleMatchesFilter(plan.title, args.titleContains)) continue;
          const key = normalizedPlanTitle(plan.title);
          if (!key) continue;
          const group = byTitle.get(key) ?? [];
          group.push(plan);
          byTitle.set(key, group);
        }

        for (const group of byTitle.values()) {
          if (group.length < familyMin) continue;
          const winner = titleFamilyWinner(group, keepPlanId);
          for (const plan of group) {
            if (plan._id === winner._id) continue;
            const id = String(plan._id);
            const existing = toDelete.get(id);
            if (existing) {
              if (!existing.reasons.includes('title-family-duplicate')) {
                existing.reasons.push('title-family-duplicate');
              }
            } else {
              toDelete.set(id, { plan, reasons: ['title-family-duplicate'] });
            }
          }
        }
      }
    }

    let deleted = 0;
    for (const { plan, reasons } of toDelete.values()) {
      if (keepPlanId && String(plan._id) === keepPlanId) continue;
      addCodexSubagentExample(summary, plan, reasons);
      await deletePlanRelatedData(ctx, { planId: plan._id, ownerId: plan.ownerId });
      await ctx.db.delete(plan._id);
      deleted++;
    }

    // Deleting shifts pagination; only advance when nothing was deleted.
    const advance = deleted === 0;

    if (!result.isDone && args.continue !== false && advance) {
      await ctx.scheduler.runAfter(0, internal.planCleanup.cleanupCodexSubagentPlans, {
        adminToken: args.adminToken,
        cursor: result.continueCursor,
        limit: args.limit,
        titleContains: args.titleContains,
        keepPlanId: args.keepPlanId,
        dedupeTitleFamilies: args.dedupeTitleFamilies,
        minTitleFamilySize: args.minTitleFamilySize,
        continue: args.continue,
      });
    } else if (!advance && args.continue !== false) {
      // Re-scan from the same cursor so rows that slid into this page aren't skipped.
      await ctx.scheduler.runAfter(0, internal.planCleanup.cleanupCodexSubagentPlans, {
        adminToken: args.adminToken,
        cursor: args.cursor ?? null,
        limit: args.limit,
        titleContains: args.titleContains,
        keepPlanId: args.keepPlanId,
        dedupeTitleFamilies: args.dedupeTitleFamilies,
        minTitleFamilySize: args.minTitleFamilySize,
        continue: args.continue,
      });
    }

    return {
      mode: 'codex-subagent-apply' as const,
      ...summary,
      deleted,
      isDone: advance && result.isDone,
      continueCursor: advance
        ? result.isDone
          ? null
          : result.continueCursor
        : (args.cursor ?? null),
    };
  },
});
