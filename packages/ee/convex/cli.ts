import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { httpAction, internalMutation, internalQuery, mutation, query } from './_generated/server';
import { authComponent, createAuth } from './auth';
import { deletePlanRelatedData } from './planDeletion';
import { hasLowValueMetadata } from './planVisibility';
import { stripLocalIpFromMetadata } from './privacy';

const DAEMON_HEARTBEAT_RETENTION_MS = 7 * 86_400_000;
const DAEMON_HEARTBEAT_CLEANUP_INTERVAL_MS = 6 * 3_600_000;

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

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

    if (args.existingId && args.existingVersion !== undefined) {
      await ctx.db.patch(args.existingId, {
        agent: args.agent,
        title: args.title,
        content: args.content,
        format: args.format,
        filePath: args.filePath,
        workspace: args.workspace,
        metadata: args.metadata,
        version: args.existingVersion + 1,
        updatedAt: args.updatedAt ?? now,
      });
      return args.existingId;
    }

    return await ctx.db.insert('plans', {
      ownerId: args.ownerId,
      localPlanId: args.localPlanId,
      agent: args.agent,
      title: args.title,
      content: args.content,
      format: args.format,
      filePath: args.filePath,
      workspace: args.workspace,
      metadata: args.metadata,
      version: 1,
      createdAt: args.createdAt ?? now,
      updatedAt: args.updatedAt ?? now,
    });
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

    const metadata =
      privacyPreferences.collectLocalIpAddress === false
        ? stripLocalIpFromMetadata(body.metadata).metadata
        : body.metadata;

    const existing = await ctx.runQuery(internal.cli.findPlanByOwnerAndLocalId, {
      ownerId,
      localPlanId: body.localPlanId,
    });

    if (hasLowValueMetadata(metadata)) {
      const deleted = existing
        ? await ctx.runMutation(internal.cli.deleteSyncedPlan, {
            ownerId,
            planId: existing._id,
          })
        : false;

      return jsonResponse({ ok: true, skippedLowValue: true, deleted });
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
      metadata,
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
