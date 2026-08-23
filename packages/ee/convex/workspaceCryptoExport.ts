import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { query } from './_generated/server';
import { authComponent } from './auth';
import { resolveWorkspaceCryptoPolicy } from './workspaceCrypto';

const exportTable = v.union(
  v.literal('plans'),
  v.literal('planVersions'),
  v.literal('planAnnotations'),
  v.literal('comments'),
  v.literal('planLinks'),
  v.literal('tags'),
  v.literal('planTags'),
  v.literal('collections'),
  v.literal('collectionPlans'),
  v.literal('plannotatorWritebacks'),
  v.literal('daemonHeartbeats'),
  v.literal('agentAvatars'),
  v.literal('workspaceMembers'),
  v.literal('workspaceInvites'),
  v.literal('workspaceKeyGrants'),
  v.literal('workspaceCryptoSettings'),
  v.literal('accountPreferences'),
);

export const accountSnapshot = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');
    const policy = await resolveWorkspaceCryptoPolicy(ctx, user._id);
    if (!policy.requiresEncryption) {
      throw new ConvexError('Client-side export is only available for Obfuscation workspaces');
    }
    const subscription = await ctx.db
      .query('subscriptions')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .first();
    return {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        image: user.image,
        createdAt: user.createdAt,
      },
      subscription,
      exportedAt: Date.now(),
    };
  },
});

export const page = query({
  args: { table: exportTable, paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');
    const policy = await resolveWorkspaceCryptoPolicy(ctx, user._id);
    if (!policy.requiresEncryption) {
      throw new ConvexError('Client-side export is only available for Obfuscation workspaces');
    }

    switch (args.table) {
      case 'plans':
        return await ctx.db
          .query('plans')
          .withIndex('by_owner', (q) => q.eq('ownerId', user._id))
          .paginate(args.paginationOpts);
      case 'planVersions':
        return await ctx.db
          .query('planVersions')
          .withIndex('by_owner_createdAt', (q) => q.eq('ownerId', user._id))
          .paginate(args.paginationOpts);
      case 'planAnnotations':
        return await ctx.db
          .query('planAnnotations')
          .withIndex('by_owner', (q) => q.eq('ownerId', user._id))
          .paginate(args.paginationOpts);
      case 'comments': {
        const result = await ctx.db
          .query('comments')
          .withIndex('by_owner', (q) => q.eq('ownerId', user._id))
          .paginate(args.paginationOpts);
        return {
          ...result,
          page: await Promise.all(
            result.page.map(async (row) => ({
              ...row,
              attachments: await Promise.all(
                (row.attachments ?? []).map(async (attachment) => ({
                  ...attachment,
                  url: await ctx.storage.getUrl(attachment.storageId),
                })),
              ),
            })),
          ),
        };
      }
      case 'planLinks':
        return await ctx.db
          .query('planLinks')
          .withIndex('by_owner_plan', (q) => q.eq('ownerId', user._id))
          .paginate(args.paginationOpts);
      case 'tags':
        return await ctx.db
          .query('tags')
          .withIndex('by_owner', (q) => q.eq('ownerId', user._id))
          .paginate(args.paginationOpts);
      case 'planTags':
        return await ctx.db
          .query('planTags')
          .withIndex('by_owner_plan', (q) => q.eq('ownerId', user._id))
          .paginate(args.paginationOpts);
      case 'collections':
        return await ctx.db
          .query('collections')
          .withIndex('by_owner', (q) => q.eq('ownerId', user._id))
          .paginate(args.paginationOpts);
      case 'collectionPlans':
        return await ctx.db
          .query('collectionPlans')
          .withIndex('by_owner', (q) => q.eq('ownerId', user._id))
          .paginate(args.paginationOpts);
      case 'plannotatorWritebacks':
        return await ctx.db
          .query('plannotatorWritebacks')
          .withIndex('by_owner_status', (q) => q.eq('ownerId', user._id))
          .paginate(args.paginationOpts);
      case 'daemonHeartbeats':
        return await ctx.db
          .query('daemonHeartbeats')
          .withIndex('by_owner', (q) => q.eq('ownerId', user._id))
          .paginate(args.paginationOpts);
      case 'agentAvatars': {
        const result = await ctx.db
          .query('agentAvatars')
          .withIndex('by_owner', (q) => q.eq('ownerId', user._id))
          .paginate(args.paginationOpts);
        return {
          ...result,
          page: await Promise.all(
            result.page.map(async (row) => ({
              ...row,
              url: await ctx.storage.getUrl(row.storageId),
            })),
          ),
        };
      }
      case 'workspaceMembers':
        return await ctx.db
          .query('workspaceMembers')
          .withIndex('by_workspace', (q) => q.eq('workspaceOwnerId', user._id))
          .paginate(args.paginationOpts);
      case 'workspaceInvites':
        return await ctx.db
          .query('workspaceInvites')
          .withIndex('by_workspace', (q) => q.eq('workspaceOwnerId', user._id))
          .paginate(args.paginationOpts);
      case 'workspaceKeyGrants':
        return await ctx.db
          .query('workspaceKeyGrants')
          .withIndex('by_workspace', (q) => q.eq('workspaceOwnerId', user._id))
          .paginate(args.paginationOpts);
      case 'workspaceCryptoSettings':
        return await ctx.db
          .query('workspaceCryptoSettings')
          .withIndex('by_owner', (q) => q.eq('ownerId', user._id))
          .paginate(args.paginationOpts);
      case 'accountPreferences':
        return await ctx.db
          .query('accountPreferences')
          .withIndex('by_owner', (q) => q.eq('ownerId', user._id))
          .paginate(args.paginationOpts);
    }
  },
});
