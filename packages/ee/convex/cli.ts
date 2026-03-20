import { CLI_DAEMON_STALE_AFTER_MS } from '@agendex/shared/daemon-status';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import { httpAction, internalMutation, internalQuery, query } from './_generated/server';
import { authComponent, createAuth } from './auth';

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

export const hasUserSubscription = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
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
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const auth = createAuth(ctx);
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const ownerId = session.user.id;

  try {
    const hasSub = await ctx.runQuery(internal.cli.hasUserSubscription, {
      userId: ownerId,
    });
    if (!hasSub) {
      return new Response(JSON.stringify({ error: 'Cloud Pro subscription required' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await request.json();

    if (
      typeof body.localPlanId !== 'string' ||
      typeof body.agent !== 'string' ||
      typeof body.title !== 'string' ||
      typeof body.content !== 'string' ||
      typeof body.format !== 'string'
    ) {
      return new Response(
        JSON.stringify({
          error: 'Missing required fields: localPlanId, agent, title, content, format',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (
      (body.filePath !== undefined && typeof body.filePath !== 'string') ||
      (body.workspace !== undefined && typeof body.workspace !== 'string') ||
      (body.createdAt !== undefined && typeof body.createdAt !== 'number') ||
      (body.updatedAt !== undefined && typeof body.updatedAt !== 'number')
    ) {
      return new Response(JSON.stringify({ error: 'Invalid optional field types' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const existing = await ctx.runQuery(internal.cli.findPlanByOwnerAndLocalId, {
      ownerId,
      localPlanId: body.localPlanId,
    });

    const planId = await ctx.runMutation(internal.cli.upsertPlan, {
      ownerId,
      localPlanId: body.localPlanId,
      agent: body.agent,
      title: body.title,
      content: body.content,
      format: body.format,
      filePath: body.filePath,
      workspace: body.workspace,
      metadata: body.metadata,
      createdAt: body.createdAt,
      updatedAt: body.updatedAt,
      existingId: existing?._id,
      existingVersion: existing?.version,
    });

    return new Response(JSON.stringify({ ok: true, planId }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Sync error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

export const upsertHeartbeat = internalMutation({
  args: {
    ownerId: v.string(),
    deviceId: v.optional(v.string()),
    hostname: v.optional(v.string()),
    startedAtMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = args.deviceId
      ? await ctx.db
          .query('daemonHeartbeats')
          .withIndex('by_owner_device', (q) =>
            q.eq('ownerId', args.ownerId).eq('deviceId', args.deviceId),
          )
          .first()
      : await ctx.db
          .query('daemonHeartbeats')
          .withIndex('by_owner', (q) => q.eq('ownerId', args.ownerId))
          .first();

    // Clean up stale/legacy rows for this owner
    if (args.deviceId) {
      const allRows = await ctx.db
        .query('daemonHeartbeats')
        .withIndex('by_owner', (q) => q.eq('ownerId', args.ownerId))
        .collect();
      const now = Date.now();
      for (const row of allRows) {
        // Delete legacy rows (no deviceId) or rows stale for over 24 hours
        if (
          !row.deviceId ||
          (row.deviceId !== args.deviceId && now - row.lastSeenAt > 86_400_000)
        ) {
          await ctx.db.delete(row._id);
        }
      }
    }

    const patch: Record<string, unknown> = { lastSeenAt: Date.now() };
    if (args.deviceId !== undefined) patch.deviceId = args.deviceId;
    if (args.hostname !== undefined) patch.hostname = args.hostname;
    if (args.startedAtMs !== undefined) patch.startedAtMs = args.startedAtMs;

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert('daemonHeartbeats', {
        ownerId: args.ownerId,
        lastSeenAt: Date.now(),
        ...(args.deviceId !== undefined && { deviceId: args.deviceId }),
        ...(args.hostname !== undefined && { hostname: args.hostname }),
        ...(args.startedAtMs !== undefined && { startedAtMs: args.startedAtMs }),
      });
    }
  },
});

export const getDaemonStatus = query({
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return { devices: [] };
    const heartbeats = await ctx.db
      .query('daemonHeartbeats')
      .withIndex('by_owner', (q) => q.eq('ownerId', user._id))
      .collect();
    return {
      devices: heartbeats.map((hb) => ({
        alive: Date.now() - hb.lastSeenAt < CLI_DAEMON_STALE_AFTER_MS,
        lastSeenAt: hb.lastSeenAt,
        deviceId: hb.deviceId ?? null,
        hostname: hb.hostname ?? null,
        startedAtMs: hb.startedAtMs ?? null,
      })),
    };
  },
});

export const heartbeat = httpAction(async (ctx, request) => {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const auth = createAuth(ctx);
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: Record<string, unknown> = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Old CLIs send no body — tolerate gracefully
  }

  const deviceId = typeof body.deviceId === 'string' ? body.deviceId : undefined;
  const hostname = typeof body.hostname === 'string' ? body.hostname : undefined;
  const startedAtMs = typeof body.startedAtMs === 'number' ? body.startedAtMs : undefined;

  await ctx.runMutation(internal.cli.upsertHeartbeat, {
    ownerId: session.user.id,
    deviceId,
    hostname,
    startedAtMs,
  });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});

export const refresh = httpAction(async (ctx, request) => {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const auth = createAuth(ctx);
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    return new Response(
      JSON.stringify({
        token: session.session.token,
        expiresAt: session.session.expiresAt ? new Date(session.session.expiresAt).getTime() : 0,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to refresh' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
