import { ProFeature } from '@agendex/shared/types';
import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { authComponent } from './auth';
import { requireFeature } from './entitlements';
import { hasActiveSubscriptionForUserId } from './subscriptions';

const SEAT_LIMIT = 5;

export const getMyMembership = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return null;

    return await ctx.db
      .query('workspaceMembers')
      .withIndex('by_member', (q) => q.eq('memberId', user._id))
      .first();
  },
});

export const listWorkspaceMembers = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.WORKSPACE_MEMBERS);

    const members = await ctx.db
      .query('workspaceMembers')
      .withIndex('by_workspace', (q) => q.eq('workspaceOwnerId', user._id))
      .collect();

    const pendingInvites = (
      await ctx.db
        .query('workspaceInvites')
        .withIndex('by_workspace', (q) => q.eq('workspaceOwnerId', user._id))
        .collect()
    ).filter((inv) => !inv.acceptedAt && !inv.revokedAt);

    const usedSeats = 1 + members.length + pendingInvites.length;

    return {
      members,
      pendingInvites,
      seatLimit: SEAT_LIMIT,
      usedSeats,
      remainingSeats: Math.max(0, SEAT_LIMIT - usedSeats),
    };
  },
});

export const inviteWorkspaceMember = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.WORKSPACE_MEMBERS);

    const emailLc = args.email.trim().toLowerCase();
    if (!emailLc) throw new ConvexError('Email cannot be empty');

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailLc)) throw new ConvexError('Invalid email address');

    if (user.email && user.email.toLowerCase() === emailLc) {
      throw new ConvexError('You cannot invite yourself');
    }

    const existingMember = await ctx.db
      .query('workspaceMembers')
      .withIndex('by_workspace_emailLc', (q) =>
        q.eq('workspaceOwnerId', user._id).eq('emailLc', emailLc),
      )
      .first();

    if (existingMember) throw new ConvexError('This email is already a workspace member');

    const existingInvite = (
      await ctx.db
        .query('workspaceInvites')
        .withIndex('by_workspace_emailLc', (q) =>
          q.eq('workspaceOwnerId', user._id).eq('emailLc', emailLc),
        )
        .collect()
    ).find((inv) => !inv.acceptedAt && !inv.revokedAt);

    if (existingInvite) throw new ConvexError('An invite for this email is already pending');

    const members = await ctx.db
      .query('workspaceMembers')
      .withIndex('by_workspace', (q) => q.eq('workspaceOwnerId', user._id))
      .collect();

    const pendingInvites = (
      await ctx.db
        .query('workspaceInvites')
        .withIndex('by_workspace', (q) => q.eq('workspaceOwnerId', user._id))
        .collect()
    ).filter((inv) => !inv.acceptedAt && !inv.revokedAt);

    if (members.length + pendingInvites.length >= SEAT_LIMIT - 1) {
      throw new ConvexError('Workspace seat limit reached');
    }

    const token = crypto.randomUUID();

    await ctx.db.insert('workspaceInvites', {
      workspaceOwnerId: user._id,
      email: args.email.trim(),
      emailLc,
      token,
      createdAt: Date.now(),
    });

    return { token };
  },
});

export const revokeWorkspaceInvite = mutation({
  args: { inviteId: v.id('workspaceInvites') },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.WORKSPACE_MEMBERS);

    const invite = await ctx.db.get(args.inviteId);
    if (!invite) throw new ConvexError('Invite not found');

    if (invite.workspaceOwnerId !== user._id) {
      throw new ConvexError('Access denied');
    }

    await ctx.db.patch(args.inviteId, { revokedAt: Date.now() });
  },
});

export const removeWorkspaceMember = mutation({
  args: { membershipId: v.id('workspaceMembers') },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    await requireFeature(ctx, ProFeature.WORKSPACE_MEMBERS);

    const membership = await ctx.db.get(args.membershipId);
    if (!membership) throw new ConvexError('Membership not found');

    if (membership.workspaceOwnerId !== user._id) {
      throw new ConvexError('Access denied');
    }

    if (membership.memberId === user._id) {
      throw new ConvexError('You cannot remove yourself');
    }

    await ctx.db.delete(args.membershipId);
  },
});

export const getWorkspaceInviteByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const invite = await ctx.db
      .query('workspaceInvites')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .first();

    if (!invite) {
      return { status: 'not_found' as const };
    }

    if (invite.revokedAt) {
      return { status: 'revoked' as const };
    }

    if (invite.acceptedAt) {
      return { status: 'accepted' as const };
    }

    return {
      status: 'valid' as const,
      email: invite.email,
      workspaceOwnerId: invite.workspaceOwnerId,
    };
  },
});

export const acceptWorkspaceInvite = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    const invite = await ctx.db
      .query('workspaceInvites')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .first();

    if (!invite) throw new ConvexError('Invite not found');
    if (invite.revokedAt) throw new ConvexError('This invite has been revoked');
    if (invite.acceptedAt) throw new ConvexError('This invite has already been accepted');

    const ownerActive = await hasActiveSubscriptionForUserId(ctx, invite.workspaceOwnerId);
    if (!ownerActive) {
      throw new ConvexError('The workspace owner does not have an active subscription');
    }

    if (!user.email || user.email.toLowerCase() !== invite.emailLc) {
      throw new ConvexError('This invite was sent to a different email address');
    }

    const existingMembership = await ctx.db
      .query('workspaceMembers')
      .withIndex('by_member', (q) => q.eq('memberId', user._id))
      .first();

    if (existingMembership) {
      throw new ConvexError('You are already a member of a workspace');
    }

    const members = await ctx.db
      .query('workspaceMembers')
      .withIndex('by_workspace', (q) => q.eq('workspaceOwnerId', invite.workspaceOwnerId))
      .collect();

    const pendingInvites = (
      await ctx.db
        .query('workspaceInvites')
        .withIndex('by_workspace', (q) => q.eq('workspaceOwnerId', invite.workspaceOwnerId))
        .collect()
    ).filter((inv) => !inv.acceptedAt && !inv.revokedAt && inv._id !== invite._id);

    if (1 + members.length + pendingInvites.length >= SEAT_LIMIT) {
      throw new ConvexError('Workspace is full');
    }

    await ctx.db.insert('workspaceMembers', {
      workspaceOwnerId: invite.workspaceOwnerId,
      memberId: user._id,
      email: invite.email,
      emailLc: invite.emailLc,
      role: 'member',
      addedAt: Date.now(),
    });

    await ctx.db.patch(invite._id, { acceptedAt: Date.now() });
  },
});
