'use node';

import { createWriteStream, openAsBlob } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { v } from 'convex/values';
import JSZip from 'jszip';
import { components, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { ActionCtx } from './_generated/server';
import { internalAction } from './_generated/server';
import {
  buildExportManifest,
  redactConnectedAccount,
  walkCursorPages,
  type CursorPage,
} from './dataExportRedaction';

type SerializedPage = {
  rowsJson: string;
  isDone: boolean;
  continueCursor: string;
};

type AccountSection =
  | 'preferences'
  | 'subscriptions'
  | 'workspaceMembersAsOwner'
  | 'workspaceMembersAsMember'
  | 'workspaceInvites'
  | 'heartbeats'
  | 'tags'
  | 'collections'
  | 'collectionPlans'
  | 'planPreferences'
  | 'agentAvatars'
  | 'pendingUploads'
  | 'uploadReservations';

type PlanSection =
  | 'versions'
  | 'annotations'
  | 'comments'
  | 'shareLinks'
  | 'planLinks'
  | 'writebacks'
  | 'planTags';

type ExportComment = {
  _id: Id<'comments'>;
  planId: Id<'plans'>;
  attachments?: Array<{
    storageId: Id<'_storage'>;
    fileName?: string;
    contentType: string;
    size: number;
  }>;
};

type AgentAvatar = {
  storageId: Id<'_storage'>;
  agent: string;
};

type PendingUpload = {
  storageId: Id<'_storage'>;
  planId: Id<'plans'>;
};

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

type JsonPageFetcher = (cursor: string | null) => Promise<SerializedPage>;

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'file';
}

function attachmentZipPath(root: string, blob: AttachmentBlob): string {
  if (blob.kind === 'avatar') {
    return `${root}/agent-avatars/${sanitizePathSegment(blob.agent ?? 'agent')}`;
  }
  if (blob.kind === 'pending') {
    const planId = blob.planId ? String(blob.planId) : 'unknown-plan';
    return `${root}/pending-uploads/${planId}/${blob.storageId}`;
  }
  const planId = blob.planId ? String(blob.planId) : 'unknown-plan';
  const fileName = sanitizePathSegment(blob.fileName ?? 'attachment');
  return `${root}/plans/${planId}/attachments/${blob.storageId}-${fileName}`;
}

function parseRows<T>(rowsJson: string): T[] {
  const parsed: unknown = JSON.parse(rowsJson);
  if (!Array.isArray(parsed)) throw new Error('Export page was not an array');
  return parsed as T[];
}

function jsonArrayStream(fetchPage: JsonPageFetcher): Readable {
  return Readable.from(
    (async function* () {
      yield '[\n';
      let cursor: string | null = null;
      let isDone = false;
      let first = true;
      while (!isDone) {
        const result = await fetchPage(cursor);
        for (const row of parseRows<unknown>(result.rowsJson)) {
          if (!first) yield ',\n';
          yield JSON.stringify(row, null, 2);
          first = false;
        }
        cursor = result.continueCursor;
        isDone = result.isDone;
      }
      yield '\n]\n';
    })(),
  );
}

function jsonObjectOfArraysStream(fields: Array<[string, JsonPageFetcher]>): Readable {
  return Readable.from(
    (async function* () {
      yield '{\n';
      for (let index = 0; index < fields.length; index += 1) {
        const [name, fetchPage] = fields[index];
        if (index > 0) yield ',\n';
        yield `${JSON.stringify(name)}: `;
        for await (const chunk of jsonArrayStream(fetchPage)) yield chunk;
      }
      yield '}\n';
    })(),
  );
}

function storedBlobStream(ctx: ActionCtx, storageId: Id<'_storage'>): Readable {
  return Readable.from(
    (async function* () {
      const blob = await ctx.storage.get(storageId);
      if (!blob) return;
      for await (const chunk of blob.stream()) yield chunk;
    })(),
  );
}

function addAttachmentEntry(
  zip: JSZip,
  ctx: ActionCtx,
  root: string,
  attachment: AttachmentBlob,
): void {
  zip.file(attachmentZipPath(root, attachment), storedBlobStream(ctx, attachment.storageId), {
    binary: true,
  });
}

function accountPageFetcher(
  ctx: ActionCtx,
  ownerId: string,
  section: AccountSection,
): JsonPageFetcher {
  return async (cursor) =>
    await ctx.runQuery(internal.dataExport.listAccountSectionPage, {
      ownerId,
      section,
      cursor,
    });
}

function planPageFetcher(
  ctx: ActionCtx,
  ownerId: string,
  planId: Id<'plans'>,
  section: PlanSection,
): JsonPageFetcher {
  return async (cursor) => {
    const page = await ctx.runQuery(internal.dataExport.listPlanSectionPage, {
      ownerId,
      planId,
      section,
      cursor,
    });
    return page ?? { rowsJson: '[]', isDone: true, continueCursor: cursor ?? '' };
  };
}

function claimPageFetcher(
  ctx: ActionCtx,
  ownerId: string,
  commentId: Id<'comments'>,
): JsonPageFetcher {
  return async (cursor) =>
    await ctx.runQuery(internal.dataExport.listCommentClaimsPage, {
      ownerId,
      commentId,
      cursor,
    });
}

function commentClaimsStream(
  ctx: ActionCtx,
  ownerId: string,
  fetchCommentsPage: JsonPageFetcher,
): Readable {
  return Readable.from(
    (async function* () {
      yield '[\n';
      let first = true;
      let commentCursor: string | null = null;
      let commentsDone = false;
      while (!commentsDone) {
        const commentsPage = await fetchCommentsPage(commentCursor);
        for (const comment of parseRows<ExportComment>(commentsPage.rowsJson)) {
          let claimCursor: string | null = null;
          let claimsDone = false;
          while (!claimsDone) {
            const claimsPage = await claimPageFetcher(ctx, ownerId, comment._id)(claimCursor);
            for (const claim of parseRows<unknown>(claimsPage.rowsJson)) {
              if (!first) yield ',\n';
              yield JSON.stringify(claim, null, 2);
              first = false;
            }
            claimCursor = claimsPage.continueCursor;
            claimsDone = claimsPage.isDone;
          }
        }
        commentCursor = commentsPage.continueCursor;
        commentsDone = commentsPage.isDone;
      }
      yield '\n]\n';
    })(),
  );
}

function commentsAndClaimsStream(
  fetchCommentsPage: JsonPageFetcher,
  claims: Readable,
): Readable {
  return Readable.from(
    (async function* () {
      yield '{\n"comments": ';
      for await (const chunk of jsonArrayStream(fetchCommentsPage)) yield chunk;
      yield ',\n"attachmentClaims": ';
      for await (const chunk of claims) yield chunk;
      yield '}\n';
    })(),
  );
}

async function discoverCommentAttachments(args: {
  zip: JSZip;
  ctx: ActionCtx;
  root: string;
  fetchCommentsPage: JsonPageFetcher;
}): Promise<void> {
  await walkCursorPages(
    async (cursor): Promise<CursorPage<ExportComment>> => {
      const page = await args.fetchCommentsPage(cursor);
      return {
        page: parseRows<ExportComment>(page.rowsJson),
        isDone: page.isDone,
        continueCursor: page.continueCursor,
      };
    },
    (comments) => {
      for (const comment of comments) {
        for (const attachment of comment.attachments ?? []) {
          addAttachmentEntry(args.zip, args.ctx, args.root, {
            storageId: attachment.storageId,
            fileName: attachment.fileName ?? null,
            contentType: attachment.contentType,
            size: attachment.size,
            planId: comment.planId,
            commentId: comment._id,
            kind: 'comment',
            agent: null,
          });
        }
      }
    },
  );
}

export const buildDataExport = internalAction({
  args: { exportId: v.id('dataExports') },
  returns: v.null(),
  handler: async (ctx, { exportId }) => {
    const job = await ctx.runQuery(internal.dataExport.getExportJob, { exportId });
    if (!job || job.status === 'ready' || job.status === 'failed') return null;

    const buildToken = randomUUID();
    const claim = await ctx.runMutation(internal.dataExport.claimExportBuild, {
      exportId,
      buildToken,
    });
    if (!claim.acquired) {
      if (claim.retryAfterMs != null) {
        await ctx.scheduler.runAfter(claim.retryAfterMs, internal.dataExportActions.buildDataExport, {
          exportId,
        });
      }
      return null;
    }

    let tempDirectory: string | null = null;
    let generatedStorageId: Id<'_storage'> | null = null;
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
      const profile =
        profileDoc && typeof profileDoc === 'object'
          ? redactConnectedAccount(profileDoc as Record<string, unknown>)
          : null;
      zip.file(`${root}/account/profile.json`, `${JSON.stringify(profile, null, 2)}\n`);

      const connectedAccountsFetcher: JsonPageFetcher = async (cursor) => {
        const page = await ctx.runQuery(components.betterAuth.adapter.findMany, {
          model: 'account',
          where: [{ field: 'userId', value: ownerId }],
          paginationOpts: { cursor, numItems: 50 },
        });
        return {
          rowsJson: JSON.stringify(
            page.page.map((account) =>
              redactConnectedAccount(
                account && typeof account === 'object'
                  ? (account as Record<string, unknown>)
                  : {},
              ),
            ),
          ),
          isDone: page.isDone,
          continueCursor: page.continueCursor,
        };
      };
      zip.file(
        `${root}/account/connected-accounts.json`,
        jsonArrayStream(connectedAccountsFetcher),
      );

      zip.file(
        `${root}/account/preferences.json`,
        jsonArrayStream(accountPageFetcher(ctx, ownerId, 'preferences')),
      );
      zip.file(
        `${root}/account/subscription.json`,
        jsonArrayStream(accountPageFetcher(ctx, ownerId, 'subscriptions')),
      );
      zip.file(
        `${root}/account/workspace-members.json`,
        jsonObjectOfArraysStream([
          ['asOwner', accountPageFetcher(ctx, ownerId, 'workspaceMembersAsOwner')],
          ['asMember', accountPageFetcher(ctx, ownerId, 'workspaceMembersAsMember')],
        ]),
      );
      zip.file(
        `${root}/account/workspace-invites.json`,
        jsonArrayStream(accountPageFetcher(ctx, ownerId, 'workspaceInvites')),
      );
      zip.file(
        `${root}/devices/heartbeats.json`,
        jsonArrayStream(accountPageFetcher(ctx, ownerId, 'heartbeats')),
      );
      zip.file(`${root}/tags.json`, jsonArrayStream(accountPageFetcher(ctx, ownerId, 'tags')));
      zip.file(
        `${root}/collections.json`,
        jsonObjectOfArraysStream([
          ['collections', accountPageFetcher(ctx, ownerId, 'collections')],
          ['collectionPlans', accountPageFetcher(ctx, ownerId, 'collectionPlans')],
        ]),
      );
      zip.file(
        `${root}/plan-preferences.json`,
        jsonArrayStream(accountPageFetcher(ctx, ownerId, 'planPreferences')),
      );
      zip.file(
        `${root}/agent-avatars.json`,
        jsonArrayStream(accountPageFetcher(ctx, ownerId, 'agentAvatars')),
      );
      zip.file(
        `${root}/pending-uploads.json`,
        jsonObjectOfArraysStream([
          ['pendingUploads', accountPageFetcher(ctx, ownerId, 'pendingUploads')],
          ['uploadReservations', accountPageFetcher(ctx, ownerId, 'uploadReservations')],
        ]),
      );

      await walkCursorPages(
        async (cursor): Promise<CursorPage<AgentAvatar>> => {
          const page = await accountPageFetcher(ctx, ownerId, 'agentAvatars')(cursor);
          return {
            page: parseRows<AgentAvatar>(page.rowsJson),
            isDone: page.isDone,
            continueCursor: page.continueCursor,
          };
        },
        (avatars) => {
          for (const avatar of avatars) {
            addAttachmentEntry(zip, ctx, root, {
              storageId: avatar.storageId,
              fileName: avatar.agent,
              contentType: 'application/octet-stream',
              size: 0,
              planId: null,
              commentId: null,
              kind: 'avatar',
              agent: avatar.agent,
            });
          }
        },
      );

      await walkCursorPages(
        async (cursor): Promise<CursorPage<PendingUpload>> => {
          const page = await accountPageFetcher(ctx, ownerId, 'pendingUploads')(cursor);
          return {
            page: parseRows<PendingUpload>(page.rowsJson),
            isDone: page.isDone,
            continueCursor: page.continueCursor,
          };
        },
        (pendingUploads) => {
          for (const pending of pendingUploads) {
            addAttachmentEntry(zip, ctx, root, {
              storageId: pending.storageId,
              fileName: null,
              contentType: 'application/octet-stream',
              size: 0,
              planId: pending.planId,
              commentId: null,
              kind: 'pending',
              agent: null,
            });
          }
        },
      );

      let plansCursor: string | null = null;
      let plansDone = false;
      while (!plansDone) {
        const plansPage = await ctx.runQuery(internal.dataExport.listOwnedPlansPage, {
          ownerId,
          cursor: plansCursor,
        });
        for (const planId of plansPage.planIds) {
          const planDir = `${root}/plans/${planId}`;
          zip.file(
            `${planDir}/plan.json`,
            Readable.from(
              (async function* () {
                const json = await ctx.runQuery(internal.dataExport.getOwnedPlanJson, {
                  ownerId,
                  planId,
                });
                yield `${json ?? 'null'}\n`;
              })(),
            ),
          );

          const commentsFetcher = planPageFetcher(ctx, ownerId, planId, 'comments');
          const sectionFiles: Array<[PlanSection, string]> = [
            ['versions', 'versions.json'],
            ['annotations', 'annotations.json'],
            ['comments', 'comments.json'],
            ['shareLinks', 'share-links.json'],
            ['planLinks', 'plan-links.json'],
            ['writebacks', 'writebacks.json'],
            ['planTags', 'plan-tags.json'],
          ];
          for (const [section, fileName] of sectionFiles) {
            zip.file(
              `${planDir}/${fileName}`,
              jsonArrayStream(planPageFetcher(ctx, ownerId, planId, section)),
            );
          }
          zip.file(
            `${planDir}/attachment-claims.json`,
            commentClaimsStream(ctx, ownerId, commentsFetcher),
          );
          await discoverCommentAttachments({ zip, ctx, root, fetchCommentsPage: commentsFetcher });
        }
        plansCursor = plansPage.continueCursor;
        plansDone = plansPage.isDone;
      }

      const elsewhereFetcher: JsonPageFetcher = async (cursor) =>
        await ctx.runQuery(internal.dataExport.listAuthoredElsewhereCommentsPage, {
          ownerId,
          cursor,
        });
      zip.file(
        `${root}/comments-authored-elsewhere.json`,
        commentsAndClaimsStream(
          elsewhereFetcher,
          commentClaimsStream(ctx, ownerId, elsewhereFetcher),
        ),
      );
      await discoverCommentAttachments({ zip, ctx, root, fetchCommentsPage: elsewhereFetcher });

      tempDirectory = await mkdtemp(join(tmpdir(), 'agendex-export-'));
      const fileName = `${root}.zip`;
      const archivePath = join(tempDirectory, fileName);
      await pipeline(
        zip.generateNodeStream({
          type: 'nodebuffer',
          compression: 'DEFLATE',
          streamFiles: true,
        }),
        createWriteStream(archivePath),
      );

      const archiveStat = await stat(archivePath);
      const archiveBlob = await openAsBlob(archivePath, { type: 'application/zip' });
      generatedStorageId = await ctx.storage.store(archiveBlob);
      const accepted = await ctx.runMutation(internal.dataExport.markExportReady, {
        exportId,
        buildToken,
        storageId: generatedStorageId,
        byteSize: archiveStat.size,
        fileName,
      });
      generatedStorageId = null;
      if (!accepted) return null;
    } catch (error) {
      if (generatedStorageId) {
        try {
          await ctx.storage.delete(generatedStorageId);
        } catch {
          // The claim-aware ready mutation may already have removed it.
        }
      }
      const message = error instanceof Error ? error.message : 'Failed to build data export';
      console.error('data export failed', { exportId, message });
      await ctx.runMutation(internal.dataExport.markExportFailed, {
        exportId,
        buildToken,
        error: message,
      });
    } finally {
      if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true });
    }

    return null;
  },
});
