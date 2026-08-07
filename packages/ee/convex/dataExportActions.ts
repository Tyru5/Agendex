'use node';

import { v } from 'convex/values';
import JSZip from 'jszip';
import { components, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { internalAction } from './_generated/server';
import {
  buildExportManifest,
  redactConnectedAccount,
} from './dataExportRedaction';

const PLAN_PAGE_SIZE = 20;

type AttachmentBlob = {
  storageId: Id<'_storage'>;
  fileName: string | null;
  contentType: string;
  size: number;
  planId: Id<'plans'> | null;
  commentId: Id<'comments'> | null;
  kind: 'comment' | 'avatar' | 'pending';
  agent: string | null;
};

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'file';
}

function attachmentZipPath(root: string, blob: AttachmentBlob): string {
  if (blob.kind === 'avatar') {
    const agent = sanitizePathSegment(blob.agent ?? 'agent');
    return `${root}/agent-avatars/${agent}`;
  }
  if (blob.kind === 'pending') {
    const planId = blob.planId ? String(blob.planId) : 'unknown-plan';
    return `${root}/pending-uploads/${planId}/${blob.storageId}`;
  }
  const planId = blob.planId ? String(blob.planId) : 'unknown-plan';
  const fileName = sanitizePathSegment(blob.fileName ?? 'attachment');
  return `${root}/plans/${planId}/attachments/${blob.storageId}-${fileName}`;
}

export const buildDataExport = internalAction({
  args: { exportId: v.id('dataExports') },
  returns: v.null(),
  handler: async (ctx, { exportId }) => {
    const job = await ctx.runQuery(internal.dataExport.getExportJob, { exportId });
    if (!job) return null;
    if (job.status !== 'pending' && job.status !== 'building') return null;

    await ctx.runMutation(internal.dataExport.markExportBuilding, { exportId });

    try {
      const ownerId = job.ownerId;
      const createdAt = job.createdAt;
      const root = `agendex-export-${new Date(createdAt).toISOString().replace(/[:.]/g, '-')}`;
      const zip = new JSZip();

      zip.file(
        `${root}/manifest.json`,
        `${JSON.stringify(buildExportManifest({ ownerId, createdAt, exportId: String(exportId) }), null, 2)}\n`,
      );

      const profileDoc = await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: 'user',
        where: [{ field: '_id', value: ownerId }],
      });

      const accountsPage = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'account',
        where: [{ field: 'userId', value: ownerId }],
        paginationOpts: { cursor: null, numItems: 100 },
      });

      const profile =
        profileDoc && typeof profileDoc === 'object'
          ? redactConnectedAccount(profileDoc as Record<string, unknown>)
          : null;
      const accountRows: unknown[] = accountsPage.page;
      const connectedAccounts = accountRows.map((account) =>
        redactConnectedAccount(
          account && typeof account === 'object'
            ? (account as Record<string, unknown>)
            : {},
        ),
      );

      zip.file(`${root}/account/profile.json`, JSON.stringify(profile, null, 2) + '\n');
      zip.file(
        `${root}/account/connected-accounts.json`,
        JSON.stringify(connectedAccounts, null, 2) + '\n',
      );

      const accountBundle = await ctx.runQuery(internal.dataExport.collectAccountBundle, {
        ownerId,
      });

      zip.file(
        `${root}/account/preferences.json`,
        JSON.stringify(accountBundle.preferences, null, 2) + '\n',
      );
      zip.file(
        `${root}/account/subscription.json`,
        JSON.stringify(accountBundle.subscriptions, null, 2) + '\n',
      );
      zip.file(
        `${root}/account/workspace-members.json`,
        JSON.stringify(accountBundle.workspaceMembers, null, 2) + '\n',
      );
      zip.file(
        `${root}/account/workspace-invites.json`,
        JSON.stringify(accountBundle.workspaceInvites, null, 2) + '\n',
      );
      zip.file(
        `${root}/devices/heartbeats.json`,
        JSON.stringify(accountBundle.heartbeats, null, 2) + '\n',
      );
      zip.file(`${root}/tags.json`, JSON.stringify(accountBundle.tags, null, 2) + '\n');
      zip.file(
        `${root}/collections.json`,
        JSON.stringify(accountBundle.collections, null, 2) + '\n',
      );
      zip.file(
        `${root}/plan-preferences.json`,
        JSON.stringify(accountBundle.planPreferences, null, 2) + '\n',
      );
      zip.file(
        `${root}/agent-avatars.json`,
        JSON.stringify(accountBundle.agentAvatars, null, 2) + '\n',
      );
      zip.file(
        `${root}/pending-uploads.json`,
        JSON.stringify(
          {
            pendingUploads: accountBundle.pendingUploads,
            uploadReservations: accountBundle.uploadReservations,
          },
          null,
          2,
        ) + '\n',
      );

      const attachmentBlobs: AttachmentBlob[] = [...accountBundle.attachmentBlobs];

      let cursor: string | null = null;
      let isDone = false;
      while (!isDone) {
        const plansPage: {
          page: Array<{ _id: Id<'plans'> }>;
          isDone: boolean;
          continueCursor: string;
        } = await ctx.runQuery(internal.dataExport.listOwnedPlansPage, {
          ownerId,
          paginationOpts: { numItems: PLAN_PAGE_SIZE, cursor },
        });

        for (const planSummary of plansPage.page) {
          const bundle = await ctx.runQuery(internal.dataExport.collectPlanBundle, {
            ownerId,
            planId: planSummary._id,
          });
          if (!bundle) continue;

          const planDir = `${root}/plans/${planSummary._id}`;
          zip.file(`${planDir}/plan.json`, JSON.stringify(bundle.plan, null, 2) + '\n');
          zip.file(`${planDir}/versions.json`, JSON.stringify(bundle.versions, null, 2) + '\n');
          zip.file(
            `${planDir}/annotations.json`,
            JSON.stringify(bundle.annotations, null, 2) + '\n',
          );
          zip.file(`${planDir}/comments.json`, JSON.stringify(bundle.comments, null, 2) + '\n');
          zip.file(
            `${planDir}/share-links.json`,
            JSON.stringify(bundle.shareLinks, null, 2) + '\n',
          );
          zip.file(`${planDir}/plan-links.json`, JSON.stringify(bundle.planLinks, null, 2) + '\n');
          zip.file(
            `${planDir}/writebacks.json`,
            JSON.stringify(bundle.writebacks, null, 2) + '\n',
          );
          zip.file(`${planDir}/plan-tags.json`, JSON.stringify(bundle.planTags, null, 2) + '\n');
          attachmentBlobs.push(...bundle.attachmentBlobs);
        }

        isDone = plansPage.isDone;
        cursor = plansPage.continueCursor;
      }

      const elsewhere = await ctx.runQuery(internal.dataExport.collectAuthoredElsewhereComments, {
        ownerId,
      });
      zip.file(
        `${root}/comments-authored-elsewhere.json`,
        JSON.stringify(elsewhere.comments, null, 2) + '\n',
      );
      attachmentBlobs.push(...elsewhere.attachmentBlobs);

      const seenStorage = new Set<string>();
      for (const blob of attachmentBlobs) {
        const key = String(blob.storageId);
        if (seenStorage.has(key)) continue;
        seenStorage.add(key);

        const bytes = await ctx.storage.get(blob.storageId);
        if (!bytes) continue;
        const path = attachmentZipPath(root, blob);
        zip.file(path, Buffer.from(await bytes.arrayBuffer()));
      }

      const zipArrayBuffer = await zip.generateAsync({
        type: 'arraybuffer',
        compression: 'DEFLATE',
      });
      const fileName = `${root}.zip`;
      const storageId = await ctx.storage.store(
        new Blob([zipArrayBuffer], { type: 'application/zip' }),
      );

      await ctx.runMutation(internal.dataExport.markExportReady, {
        exportId,
        storageId,
        byteSize: zipArrayBuffer.byteLength,
        fileName,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to build data export';
      console.error('data export failed', { exportId, message });
      await ctx.runMutation(internal.dataExport.markExportFailed, {
        exportId,
        error: message,
      });
    }

    return null;
  },
});
