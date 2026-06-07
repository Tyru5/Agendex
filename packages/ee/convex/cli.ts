import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import {
  httpAction,
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
  query,
} from './_generated/server';
import { authComponent, createAuth } from './auth';
import { deletePlanRelatedData } from './planDeletion';
import {
  hasLowValueMetadata,
  mergePlanMetadata,
  metadataWithPlanValueAssessment,
} from './planVisibility';
import { stripLocalIpFromMetadata } from './privacy';

const DAEMON_HEARTBEAT_RETENTION_MS = 7 * 86_400_000;
const DAEMON_HEARTBEAT_CLEANUP_INTERVAL_MS = 6 * 3_600_000;
const MAX_SUPERSEDE_SCAN = 2_000;

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getPlannotatorMetadata(metadata: unknown): Record<string, unknown> | undefined {
  if (!isRecord(metadata)) return undefined;
  const plannotator = metadata.plannotator;
  return isRecord(plannotator) ? plannotator : undefined;
}

// All continuity keys this session could be indexed under, in descending
// specificity. The first entry is the canonical key written to the
// `plannotatorContinuityKey` column; the rest are legacy fallbacks the same
// logical session may have been indexed under before more specific identifiers
// (e.g. a stable `sourcePlanPath`) existed. Superseding must consider every
// candidate so a legacy `path:` row is still ended when its replacement now
// derives a `source:` key.
function plannotatorContinuityKeys(metadata: unknown, filePath?: string): string[] {
  const plannotator = getPlannotatorMetadata(metadata);
  if (plannotator?.kind !== 'live-session') return [];

  const keys: string[] = [];

  const sourcePlanPath =
    typeof plannotator.sourcePlanPath === 'string' ? plannotator.sourcePlanPath.trim() : '';
  if (sourcePlanPath) keys.push(`source:${sourcePlanPath}`);

  const reviewId = typeof plannotator.reviewId === 'string' ? plannotator.reviewId.trim() : '';
  if (reviewId) keys.push(`review:${reviewId}`);

  const project = typeof plannotator.project === 'string' ? plannotator.project.trim() : '';
  const label = typeof plannotator.label === 'string' ? plannotator.label.trim() : '';
  const mode = typeof plannotator.mode === 'string' ? plannotator.mode.trim() : '';
  if (project && label) keys.push(`project:${project}:label:${label}:mode:${mode}`);

  const path = filePath?.trim();
  if (path) keys.push(`path:${path}`);

  // Legacy fallback: before a stable `sourcePlanPath` existed, a live session
  // was keyed by its session JSON path. Older cloud rows for the same logical
  // session are indexed under `path:<sessionPath>`, so include it as a candidate
  // (never as the canonical key, which stays first) to supersede them.
  const sessionPath =
    typeof plannotator.sessionPath === 'string' ? plannotator.sessionPath.trim() : '';
  if (sessionPath) keys.push(`path:${sessionPath}`);

  return keys;
}

function plannotatorContinuityKey(metadata: unknown, filePath?: string): string | undefined {
  return plannotatorContinuityKeys(metadata, filePath)[0];
}

function isLivePlannotatorMetadata(metadata: unknown): boolean {
  const plannotator = getPlannotatorMetadata(metadata);
  // Require positive proof of liveness, consistent with
  // `planHasLivePlannotatorMetadata` in plannotator.ts. A `writebackCapable` row
  // without `liveness: 'live'` is not reachable, so it neither supersedes others
  // nor is treated as a live session to be superseded.
  return (
    plannotator?.kind === 'live-session' &&
    plannotator.writebackCapable === true &&
    plannotator.liveness === 'live'
  );
}

async function markSupersededPlannotatorSessions(
  ctx: MutationCtx,
  {
    ownerId,
    canonicalPlanId,
    canonicalLocalPlanId,
    metadata,
    filePath,
    now,
  }: {
    ownerId: string;
    canonicalPlanId: Id<'plans'>;
    canonicalLocalPlanId: string;
    metadata: unknown;
    filePath?: string;
    now: number;
  },
): Promise<void> {
  // Only a live session supersedes its older siblings. An ended/superseded
  // payload (e.g. the daemon syncing `liveness: 'ended'`) must never mark other
  // genuinely live rows as superseded by a dead session.
  if (!isLivePlannotatorMetadata(metadata)) return;

  const candidateKeys = new Set(plannotatorContinuityKeys(metadata, filePath));
  if (candidateKeys.size === 0) return;

  // Scan the owner's plans rather than relying solely on the
  // `by_owner_plannotatorContinuityKey` index: legacy rows synced before that
  // column existed are indexed under `undefined`, and rows whose local identity
  // changed may have been indexed under a different fallback key (e.g. `path:`
  // before a stable `source:` existed). Matching on each row's freshly derived
  // canonical key against the candidate set catches all of these. Only
  // live-session upserts reach this path, so the scan is bounded in practice and
  // additionally capped for safety.
  const ownerPlans = await ctx.db
    .query('plans')
    .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
    // Newest first: live sessions being superseded are recent, so the cap only
    // ever excludes old plans that cannot be active live sessions.
    .order('desc')
    .take(MAX_SUPERSEDE_SCAN);

  for (const plan of ownerPlans) {
    if (plan._id === canonicalPlanId || plan.localPlanId === canonicalLocalPlanId) continue;
    if (!isLivePlannotatorMetadata(plan.metadata)) continue;
    // Supersede when the two rows share ANY continuity identifier, not just when
    // the scanned row's canonical key is in the new candidate set. This catches
    // a session whose local identity changed across an upgrade (e.g. the old row
    // is `source:`/`path:`-keyed and the new row only shares a `path:`/`source:`
    // fallback) without requiring both rows to agree on the top-priority key.
    const planKeys = plannotatorContinuityKeys(plan.metadata, plan.filePath);
    if (!planKeys.some((planKey) => candidateKeys.has(planKey))) continue;

    const planMetadata = isRecord(plan.metadata) ? plan.metadata : {};
    const plannotator = getPlannotatorMetadata(plan.metadata) ?? {};
    await ctx.db.patch(plan._id, {
      metadata: {
        ...planMetadata,
        plannotator: {
          ...plannotator,
          writebackCapable: false,
          liveness: 'ended',
          endedAt: now,
          supersededByLocalPlanId: canonicalLocalPlanId,
          supersededByPlanId: canonicalPlanId,
        },
      },
    });

    // Repoint still-pending write-backs onto the canonical local id. A
    // live-session identity change leaves older pending jobs referencing a
    // `localPlanId` the upgraded daemon no longer resolves via `getById`, so
    // without this they would fail delivery instead of reaching the live session.
    if (plan.localPlanId && plan.localPlanId !== canonicalLocalPlanId) {
      const pending = await ctx.db
        .query('plannotatorWritebacks')
        .withIndex('by_owner_localPlanId', (q) =>
          q.eq('ownerId', ownerId).eq('localPlanId', plan.localPlanId as string),
        )
        .filter((q) => q.eq(q.field('status'), 'pending'))
        .collect();
      for (const row of pending) {
        await ctx.db.patch(row._id, {
          localPlanId: canonicalLocalPlanId,
          planId: canonicalPlanId,
          updatedAt: now,
        });
      }
    }
  }
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function authenticateRequest(
  ctx: Parameters<typeof createAuth>[0],
  request: Request,
): Promise<{ ownerId: string } | Response> {
  const auth = createAuth(ctx);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  return { ownerId: String(session.user.id) };
}

interface HeartbeatDevice {
  lastSeenAt: number;
  deviceId: string | null;
  hostname: string | null;
  ipAddress: string | null;
  startedAtMs: number | null;
  pid: number | null;
}

function collectDevices(
  heartbeats: Array<{
    lastSeenAt: number;
    deviceId?: string;
    hostname?: string;
    ipAddress?: string;
    startedAtMs?: number;
    pid?: number;
  }>,
): HeartbeatDevice[] {
  const cutoff = Date.now() - DAEMON_HEARTBEAT_RETENTION_MS;
  return heartbeats
    .filter((hb) => hb.lastSeenAt >= cutoff)
    .map((hb) => ({
      lastSeenAt: hb.lastSeenAt,
      deviceId: hb.deviceId ?? null,
      hostname: hb.hostname ?? null,
      ipAddress: hb.ipAddress ?? null,
      startedAtMs: hb.startedAtMs ?? null,
      pid: hb.pid ?? null,
    }));
}

export const findPlanByOwnerAndLocalId = internalQuery({
  args: { ownerId: v.string(), localPlanId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('plans')
      .withIndex('by_owner_localPlanId', (q) =>
        q.eq('ownerId', args.ownerId).eq('localPlanId', args.localPlanId),
      )
      .first();
  },
});

export const upsertPlan = internalMutation({
  args: {
    ownerId: v.string(),
    localPlanId: v.string(),
    agent: v.string(),
    title: v.string(),
    content: v.string(),
    format: v.string(),
    filePath: v.optional(v.string()),
    workspace: v.optional(v.string()),
    metadata: v.optional(v.any()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    existingId: v.optional(v.id('plans')),
    existingVersion: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const continuityKey = plannotatorContinuityKey(args.metadata, args.filePath);

    if (args.existingId && args.existingVersion !== undefined) {
      await ctx.db.patch(args.existingId, {
        agent: args.agent,
        title: args.title,
        content: args.content,
        format: args.format,
        filePath: args.filePath,
        workspace: args.workspace,
        metadata: args.metadata,
        ...(continuityKey ? { plannotatorContinuityKey: continuityKey } : {}),
        version: args.existingVersion + 1,
        updatedAt: args.updatedAt ?? now,
      });
      await markSupersededPlannotatorSessions(ctx, {
        ownerId: args.ownerId,
        canonicalPlanId: args.existingId,
        canonicalLocalPlanId: args.localPlanId,
        metadata: args.metadata,
        filePath: args.filePath,
        now,
      });
      return args.existingId;
    }

    const planId = await ctx.db.insert('plans', {
      ownerId: args.ownerId,
      localPlanId: args.localPlanId,
      agent: args.agent,
      title: args.title,
      content: args.content,
      format: args.format,
      filePath: args.filePath,
      workspace: args.workspace,
      metadata: args.metadata,
      ...(continuityKey ? { plannotatorContinuityKey: continuityKey } : {}),
      version: 1,
      createdAt: args.createdAt ?? now,
      updatedAt: args.updatedAt ?? now,
    });

    await markSupersededPlannotatorSessions(ctx, {
      ownerId: args.ownerId,
      canonicalPlanId: planId,
      canonicalLocalPlanId: args.localPlanId,
      metadata: args.metadata,
      filePath: args.filePath,
      now,
    });

    return planId;
  },
});

export const deleteSyncedPlan = internalMutation({
  args: {
    ownerId: v.string(),
    planId: v.id('plans'),
  },
  handler: async (ctx, args) => {
    const plan = await ctx.db.get(args.planId);
    if (!plan || plan.ownerId !== args.ownerId) return false;

    await deletePlanRelatedData(ctx, { planId: args.planId, ownerId: args.ownerId });
    await ctx.db.delete(args.planId);
    return true;
  },
});

export const hasUserSubscription = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const bypassIds = (process.env.PRO_BYPASS_USER_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    if (bypassIds.includes(args.userId)) return true;

    const sub = await ctx.db
      .query('subscriptions')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .first();
    if (!sub) return false;
    const validStatus = sub.status === 'active' || sub.status === 'trialing';
    return validStatus && sub.currentPeriodEnd > Date.now();
  },
});

export const sync = httpAction(async (ctx, request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const authResult = await authenticateRequest(ctx, request);
  if (authResult instanceof Response) return authResult;
  const { ownerId } = authResult;

  try {
    const hasSub = await ctx.runQuery(internal.cli.hasUserSubscription, {
      userId: ownerId,
    });
    if (!hasSub) {
      return jsonResponse({ error: 'Cloud Pro subscription required' }, 403);
    }

    const body = await request.json();
    const privacyPreferences = await ctx.runQuery(internal.account.getPrivacyPreferencesForOwner, {
      ownerId,
    });

    if (
      typeof body.localPlanId !== 'string' ||
      typeof body.agent !== 'string' ||
      typeof body.title !== 'string' ||
      typeof body.content !== 'string' ||
      typeof body.format !== 'string'
    ) {
      return jsonResponse(
        { error: 'Missing required fields: localPlanId, agent, title, content, format' },
        400,
      );
    }

    if (
      (body.filePath !== undefined && typeof body.filePath !== 'string') ||
      (body.workspace !== undefined && typeof body.workspace !== 'string') ||
      (body.createdAt !== undefined && typeof body.createdAt !== 'number') ||
      (body.updatedAt !== undefined && typeof body.updatedAt !== 'number')
    ) {
      return jsonResponse({ error: 'Invalid optional field types' }, 400);
    }

    const incomingMetadata =
      privacyPreferences.collectLocalIpAddress === false
        ? stripLocalIpFromMetadata(body.metadata).metadata
        : body.metadata;

    const existing = await ctx.runQuery(internal.cli.findPlanByOwnerAndLocalId, {
      ownerId,
      localPlanId: body.localPlanId,
    });

    const metadata = mergePlanMetadata(existing?.metadata, incomingMetadata);
    const classifiedMetadata = metadataWithPlanValueAssessment(metadata, {
      title: body.title,
      content: body.content,
    });

    if (hasLowValueMetadata(classifiedMetadata)) {
      const deleted = existing
        ? await ctx.runMutation(internal.cli.deleteSyncedPlan, {
            ownerId,
            planId: existing._id,
          })
        : false;

      return jsonResponse({
        ok: true,
        skippedLowValue: true,
        deleted,
        lowValueReasons: classifiedMetadata?.lowValueReasons,
      });
    }

    const planId = await ctx.runMutation(internal.cli.upsertPlan, {
      ownerId,
      localPlanId: body.localPlanId,
      agent: body.agent,
      title: body.title,
      content: body.content,
      format: body.format,
      filePath: body.filePath,
      workspace: body.workspace,
      metadata: classifiedMetadata,
      createdAt: body.createdAt,
      updatedAt: body.updatedAt,
      existingId: existing?._id,
      existingVersion: existing?.version,
    });

    return jsonResponse({ ok: true, planId });
  } catch (err) {
    console.error('Sync error:', err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
});

export const preferences = httpAction(async (ctx, request) => {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const authResult = await authenticateRequest(ctx, request);
  if (authResult instanceof Response) return authResult;
  const { ownerId } = authResult;

  const prefs = await ctx.runQuery(internal.account.getPrivacyPreferencesForOwner, { ownerId });

  return jsonResponse({
    collectLocalIpAddress: prefs.collectLocalIpAddress,
  });
});

export const upsertHeartbeat = internalMutation({
  args: {
    ownerId: v.string(),
    deviceId: v.optional(v.string()),
    hostname: v.optional(v.string()),
    ipAddress: v.optional(v.union(v.string(), v.null())),
    startedAtMs: v.optional(v.number()),
    pid: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    let existing: Doc<'daemonHeartbeats'> | null = null;

    if (args.deviceId) {
      existing = await ctx.db
        .query('daemonHeartbeats')
        .withIndex('by_owner_device', (q) =>
          q.eq('ownerId', args.ownerId).eq('deviceId', args.deviceId),
        )
        .first();
    } else {
      // Without a deviceId we can only safely match a row that also lacks one;
      // grabbing an arbitrary owner row would clobber a different machine's record.
      const candidates = await ctx.db
        .query('daemonHeartbeats')
        .withIndex('by_owner', (q) => q.eq('ownerId', args.ownerId))
        .collect();
      existing = candidates.find((hb) => !hb.deviceId) ?? null;
    }

    let lastCleanedAt = existing?.lastCleanedAt ?? 0;
    if (!existing) {
      const sibling = await ctx.db
        .query('daemonHeartbeats')
        .withIndex('by_owner', (q) => q.eq('ownerId', args.ownerId))
        .first();
      if (sibling?.lastCleanedAt) lastCleanedAt = sibling.lastCleanedAt;
    }
    const shouldCleanup = now - lastCleanedAt >= DAEMON_HEARTBEAT_CLEANUP_INTERVAL_MS;

    if (shouldCleanup) {
      const allRows = await ctx.db
        .query('daemonHeartbeats')
        .withIndex('by_owner', (q) => q.eq('ownerId', args.ownerId))
        .collect();
      const cutoff = now - DAEMON_HEARTBEAT_RETENTION_MS;
      for (const row of allRows) {
        if (row._id !== existing?._id && row.lastSeenAt < cutoff) {
          await ctx.db.delete(row._id);
        } else if (row._id !== existing?._id) {
          await ctx.db.patch(row._id, { lastCleanedAt: now });
        }
      }
    }

    const patch: Record<string, unknown> = { lastSeenAt: now };
    if (shouldCleanup) patch.lastCleanedAt = now;
    if (args.deviceId !== undefined) patch.deviceId = args.deviceId;
    if (args.hostname !== undefined) patch.hostname = args.hostname;
    if (args.ipAddress !== undefined) patch.ipAddress = args.ipAddress ?? undefined;
    if (args.startedAtMs !== undefined) patch.startedAtMs = args.startedAtMs;
    if (args.pid !== undefined) patch.pid = args.pid;

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert('daemonHeartbeats', {
        ownerId: args.ownerId,
        lastSeenAt: now,
        lastCleanedAt: shouldCleanup ? now : lastCleanedAt,
        ...(args.deviceId !== undefined && { deviceId: args.deviceId }),
        ...(args.hostname !== undefined && { hostname: args.hostname }),
        ...(args.ipAddress ? { ipAddress: args.ipAddress } : {}),
        ...(args.startedAtMs !== undefined && { startedAtMs: args.startedAtMs }),
        ...(args.pid !== undefined && { pid: args.pid }),
      });
    }
  },
});

export const deleteDaemons = internalMutation({
  args: {
    ownerId: v.string(),
    deviceIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    let deleted = 0;
    for (const deviceId of args.deviceIds) {
      const row = await ctx.db
        .query('daemonHeartbeats')
        .withIndex('by_owner_device', (q) => q.eq('ownerId', args.ownerId).eq('deviceId', deviceId))
        .first();
      if (row) {
        await ctx.db.delete(row._id);
        deleted++;
      }
    }
    return { deleted };
  },
});

export const deleteDaemonsHttp = httpAction(async (ctx, request) => {
  if (request.method !== 'DELETE') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const authResult = await authenticateRequest(ctx, request);
  if (authResult instanceof Response) return authResult;
  const { ownerId } = authResult;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (
    !Array.isArray(body.deviceIds) ||
    body.deviceIds.length === 0 ||
    !body.deviceIds.every((id: unknown) => typeof id === 'string')
  ) {
    return jsonResponse({ error: 'deviceIds must be a non-empty array of strings' }, 400);
  }

  const result = await ctx.runMutation(internal.cli.deleteDaemons, {
    ownerId,
    deviceIds: body.deviceIds as string[],
  });

  return jsonResponse({ ok: true, deleted: result.deleted });
});

export const getDaemonStatus = query({
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return { devices: [] as HeartbeatDevice[] };
    const ownerId: string = String(user._id);
    const heartbeats = await ctx.db
      .query('daemonHeartbeats')
      .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
      .collect();
    return { devices: collectDevices(heartbeats) };
  },
});

export const removeDaemon = mutation({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) throw new Error('Unauthorized');
    const ownerId: string = String(user._id);
    const row = await ctx.db
      .query('daemonHeartbeats')
      .withIndex('by_owner_device', (q) => q.eq('ownerId', ownerId).eq('deviceId', args.deviceId))
      .first();
    if (row) {
      await ctx.db.delete(row._id);
    }
  },
});

export const heartbeat = httpAction(async (ctx, request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const authResult = await authenticateRequest(ctx, request);
  if (authResult instanceof Response) return authResult;
  const { ownerId } = authResult;

  let body: Record<string, unknown> = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Old CLIs send no body — tolerate gracefully
  }

  const privacyPreferences = await ctx.runQuery(internal.account.getPrivacyPreferencesForOwner, {
    ownerId,
  });

  const deviceId = typeof body.deviceId === 'string' ? body.deviceId : undefined;
  const hostname = typeof body.hostname === 'string' ? body.hostname : undefined;
  const rawIpAddress =
    typeof body.ipAddress === 'string'
      ? body.ipAddress
      : body.ipAddress === null
        ? null
        : undefined;
  const ipAddress = privacyPreferences.collectLocalIpAddress === false ? null : rawIpAddress;
  const startedAtMs = typeof body.startedAtMs === 'number' ? body.startedAtMs : undefined;
  const pid = typeof body.pid === 'number' ? body.pid : undefined;

  if (!deviceId) {
    console.warn('[heartbeat] received heartbeat without deviceId — upgrade CLI to latest version');
  }

  await ctx.runMutation(internal.cli.upsertHeartbeat, {
    ownerId,
    deviceId,
    hostname,
    ipAddress,
    startedAtMs,
    pid,
  });

  return jsonResponse({ ok: true });
});

export const devices = httpAction(async (ctx, request) => {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const authResult = await authenticateRequest(ctx, request);
  if (authResult instanceof Response) return authResult;
  const { ownerId } = authResult;

  const heartbeats = await ctx.runQuery(internal.cli.getDaemonHeartbeats, { ownerId });

  return jsonResponse({ devices: heartbeats });
});

export const getDaemonHeartbeats = internalQuery({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    const heartbeats = await ctx.db
      .query('daemonHeartbeats')
      .withIndex('by_owner', (q) => q.eq('ownerId', args.ownerId))
      .collect();
    return collectDevices(heartbeats);
  },
});

export const plannotatorWritebacks = httpAction(async (ctx, request) => {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const authResult = await authenticateRequest(ctx, request);
  if (authResult instanceof Response) return authResult;
  const { ownerId } = authResult;

  const url = new URL(request.url);
  const deviceId = url.searchParams.get('deviceId') || undefined;
  const rawLimit = Number.parseInt(url.searchParams.get('limit') ?? '10', 10);
  const limit = Number.isFinite(rawLimit) ? rawLimit : 10;

  await ctx.runMutation(internal.plannotator.markExpiredWritebacks, {
    ownerId,
    now: Date.now(),
  });

  const writebacks = await ctx.runQuery(internal.plannotator.pollPendingWritebacks, {
    ownerId,
    deviceId,
    limit,
  });

  return jsonResponse({ writebacks });
});

export const plannotatorWritebackReport = httpAction(async (ctx, request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const authResult = await authenticateRequest(ctx, request);
  if (authResult instanceof Response) return authResult;
  const { ownerId } = authResult;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (typeof body.writebackId !== 'string') {
    return jsonResponse({ error: 'writebackId is required' }, 400);
  }
  if (body.status !== 'sent' && body.status !== 'failed' && body.status !== 'expired') {
    return jsonResponse({ error: 'status must be sent, failed, or expired' }, 400);
  }

  try {
    await ctx.runMutation(internal.plannotator.reportWritebackStatus, {
      ownerId,
      writebackId: body.writebackId as Id<'plannotatorWritebacks'>,
      status: body.status,
      error: typeof body.error === 'string' ? body.error : undefined,
    });
  } catch (err) {
    if (err instanceof ConvexError) {
      const message = typeof err.data === 'string' ? err.data : 'Write-back not found';
      return jsonResponse({ error: message }, 404);
    }
    throw err;
  }

  return jsonResponse({ ok: true });
});

export const refresh = httpAction(async (ctx, request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const auth = createAuth(ctx);
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.session) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  try {
    return jsonResponse({
      token: session.session.token,
      expiresAt: session.session.expiresAt ? new Date(session.session.expiresAt).getTime() : 0,
    });
  } catch {
    return jsonResponse({ error: 'Failed to refresh' }, 500);
  }
});
