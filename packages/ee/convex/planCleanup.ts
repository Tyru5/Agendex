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
