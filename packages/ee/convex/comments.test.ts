import { expect, test } from 'bun:test';
import type { Id } from './_generated/dataModel';
import { cleanupExpiredCommentUploads, COMMENT_UPLOAD_CLEANUP_BATCH_SIZE } from './comments';

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

type StorageId = Id<'_storage'>;
type CleanupContext = Parameters<typeof cleanupExpiredCommentUploads>[0];

type ReservationRow = {
  _id: string;
  createdAt: number;
};

type PendingUploadRow = {
  _id: string;
  createdAt: number;
  storageId: StorageId;
};

type AttachmentClaimRow = {
  _id: string;
  storageId: StorageId;
};

type StoredObject = {
  storageId: StorageId;
  createdAt: number;
};

type RangeCondition = {
  operator: 'eq' | 'lt';
  field: string;
  value: unknown;
};

type RangeBuilder = {
  eq(field: string, value: unknown): RangeBuilder;
  lt(field: string, value: unknown): RangeBuilder;
};

function storageId(value: string): StorageId {
  return value as StorageId;
}

function createCleanupFixture(options: {
  reservations?: ReservationRow[];
  pendingUploads?: PendingUploadRow[];
  attachmentClaims?: AttachmentClaimRow[];
  storedObjects?: StoredObject[];
}) {
  let reservations = [...(options.reservations ?? [])];
  let pendingUploads = [...(options.pendingUploads ?? [])];
  let attachmentClaims = [...(options.attachmentClaims ?? [])];
  const storedObjects = new Map(
    (options.storedObjects ?? []).map((object) => [object.storageId, object]),
  );
  const deletedStorageIds: StorageId[] = [];
  let scannedGlobalStorage = false;

  function rowsFor(table: string): Array<ReservationRow | PendingUploadRow | AttachmentClaimRow> {
    if (table === 'commentUploadReservations') return reservations;
    if (table === 'pendingUploads') return pendingUploads;
    if (table === 'commentAttachmentClaims') return attachmentClaims;
    throw new Error(`Unexpected table query: ${table}`);
  }

  const db = {
    query(table: string) {
      return {
        withIndex(_indexName: string, buildRange: (builder: RangeBuilder) => unknown) {
          const conditions: RangeCondition[] = [];
          const builder: RangeBuilder = {
            eq(field, value) {
              conditions.push({ operator: 'eq', field, value });
              return builder;
            },
            lt(field, value) {
              conditions.push({ operator: 'lt', field, value });
              return builder;
            },
          };
          buildRange(builder);

          const rows = rowsFor(table).filter((row) =>
            conditions.every((condition) => {
              const rowValue = Reflect.get(row, condition.field) as unknown;
              if (condition.operator === 'eq') return rowValue === condition.value;
              return typeof rowValue === 'number' && rowValue < Number(condition.value);
            }),
          );

          return {
            async take(limit: number) {
              return rows.slice(0, limit);
            },
            async first() {
              return rows[0] ?? null;
            },
          };
        },
      };
    },
    async delete(id: string) {
      reservations = reservations.filter((row) => row._id !== id);
      pendingUploads = pendingUploads.filter((row) => row._id !== id);
      attachmentClaims = attachmentClaims.filter((row) => row._id !== id);
    },
    system: {
      query() {
        scannedGlobalStorage = true;
        throw new Error('Comment cleanup must not scan global storage');
      },
    },
  };

  const storage = {
    async delete(id: StorageId) {
      if (!storedObjects.has(id)) throw new Error(`Missing storage object: ${id}`);
      storedObjects.delete(id);
      deletedStorageIds.push(id);
    },
  };

  return {
    ctx: { db, storage } as unknown as CleanupContext,
    deletedStorageIds,
    hasStoredObject(id: StorageId) {
      return storedObjects.has(id);
    },
    pendingUploadCount() {
      return pendingUploads.length;
    },
    reservationCount() {
      return reservations.length;
    },
    scannedGlobalStorage() {
      return scannedGlobalStorage;
    },
  };
}

test('comment cleanup preserves a ready seven-day export and unrelated storage objects', async () => {
  const now = 10 * DAY_MS;
  const staleCreatedAt = now - 20 * MINUTE_MS;
  const commentCutoff = now - 15 * MINUTE_MS;
  const orphanedCommentUpload = storageId('comment-orphan');
  const referencedCommentUpload = storageId('comment-referenced');
  const freshCommentUpload = storageId('comment-fresh');
  const readyExportArchive = storageId('ready-export');
  const unrelatedFeatureObject = storageId('unrelated-feature');
  const readyExport = {
    status: 'ready' as const,
    storageId: readyExportArchive,
    createdAt: staleCreatedAt,
    expiresAt: staleCreatedAt + 7 * DAY_MS,
  };

  expect(readyExport.createdAt).toBeLessThan(commentCutoff);
  expect(readyExport.expiresAt).toBeGreaterThan(now);

  const fixture = createCleanupFixture({
    reservations: [
      { _id: 'reservation-stale', createdAt: staleCreatedAt },
      { _id: 'reservation-fresh', createdAt: now - MINUTE_MS },
    ],
    pendingUploads: [
      {
        _id: 'pending-orphan',
        createdAt: staleCreatedAt,
        storageId: orphanedCommentUpload,
      },
      {
        _id: 'pending-referenced',
        createdAt: staleCreatedAt,
        storageId: referencedCommentUpload,
      },
      {
        _id: 'pending-fresh',
        createdAt: now - MINUTE_MS,
        storageId: freshCommentUpload,
      },
    ],
    attachmentClaims: [{ _id: 'attachment-claim', storageId: referencedCommentUpload }],
    storedObjects: [
      { storageId: orphanedCommentUpload, createdAt: staleCreatedAt },
      { storageId: referencedCommentUpload, createdAt: staleCreatedAt },
      { storageId: freshCommentUpload, createdAt: now - MINUTE_MS },
      { storageId: readyExportArchive, createdAt: staleCreatedAt },
      { storageId: unrelatedFeatureObject, createdAt: staleCreatedAt },
    ],
  });

  const result = await cleanupExpiredCommentUploads(fixture.ctx, now);

  expect(result).toEqual({
    deletedReservations: 1,
    deletedPendingUploads: 2,
    deletedStorageFiles: 1,
    hasMore: false,
  });
  expect(fixture.deletedStorageIds).toEqual([orphanedCommentUpload]);
  expect(fixture.hasStoredObject(readyExport.storageId)).toBe(true);
  expect(fixture.hasStoredObject(unrelatedFeatureObject)).toBe(true);
  expect(fixture.hasStoredObject(referencedCommentUpload)).toBe(true);
  expect(fixture.hasStoredObject(freshCommentUpload)).toBe(true);
  expect(fixture.pendingUploadCount()).toBe(1);
  expect(fixture.reservationCount()).toBe(1);
  expect(fixture.scannedGlobalStorage()).toBe(false);
});

test('expired unclaimed comment uploads are deleted in bounded batches', async () => {
  const now = 10 * DAY_MS;
  const staleCreatedAt = now - 20 * MINUTE_MS;
  const pendingUploads = Array.from(
    { length: COMMENT_UPLOAD_CLEANUP_BATCH_SIZE + 3 },
    (_, index) => ({
      _id: `pending-${index}`,
      createdAt: staleCreatedAt,
      storageId: storageId(`comment-upload-${index}`),
    }),
  );
  const fixture = createCleanupFixture({
    pendingUploads,
    storedObjects: pendingUploads.map((upload) => ({
      storageId: upload.storageId,
      createdAt: staleCreatedAt,
    })),
  });

  const firstBatch = await cleanupExpiredCommentUploads(fixture.ctx, now);

  expect(firstBatch.deletedPendingUploads).toBe(COMMENT_UPLOAD_CLEANUP_BATCH_SIZE);
  expect(firstBatch.deletedStorageFiles).toBe(COMMENT_UPLOAD_CLEANUP_BATCH_SIZE);
  expect(firstBatch.hasMore).toBe(true);
  expect(fixture.pendingUploadCount()).toBe(3);

  const finalBatch = await cleanupExpiredCommentUploads(fixture.ctx, now);

  expect(finalBatch.deletedPendingUploads).toBe(3);
  expect(finalBatch.deletedStorageFiles).toBe(3);
  expect(finalBatch.hasMore).toBe(false);
  expect(fixture.pendingUploadCount()).toBe(0);
  expect(fixture.scannedGlobalStorage()).toBe(false);
});
