import {
  bytesToBase64,
  decryptPlanBody,
  decryptPlanSummary,
  decryptWorkspaceValue,
  openBytes,
  unpackEncryptedBlob,
} from '@agendex/shared/crypto';
import { api } from '@convex/_generated/api';
import type { ConvexReactClient } from 'convex/react';
import { strToU8, Zip, ZipPassThrough } from 'fflate';
import { withWorkspaceKey } from './obfuscation-keyring.ts';

const READABLE_TABLES = [
  'plans',
  'planVersions',
  'planAnnotations',
  'comments',
  'planLinks',
  'tags',
  'planTags',
  'collections',
  'collectionPlans',
  'plannotatorWritebacks',
  'daemonHeartbeats',
  'agentAvatars',
  'workspaceMembers',
  'workspaceInvites',
  'accountPreferences',
] as const;

const BACKUP_TABLES = [
  ...READABLE_TABLES,
  'workspaceKeyGrants',
  'workspaceCryptoSettings',
] as const;

type ReadableExportTable = (typeof READABLE_TABLES)[number];
type BackupExportTable = (typeof BACKUP_TABLES)[number];
type ExportAttachment = {
  url?: string | null;
  stableCryptoId?: string;
  keyEpoch?: number;
};
type ExportRecord = Record<string, unknown> & {
  _id: string;
  stableCryptoId?: string;
  keyEpoch?: number;
  encrypted?: boolean;
  encryptedSummary?: unknown;
  encryptedBody?: unknown;
  encryptedName?: unknown;
  encryptedDescription?: unknown;
  encryptedAttachments?: unknown;
  attachments?: ExportAttachment[];
  url?: string | null;
  agent?: string;
};

function addZipFile(zip: Zip, path: string, bytes: Uint8Array) {
  const entry = new ZipPassThrough(path);
  zip.add(entry);
  entry.push(bytes.slice(), true);
}

type ExportSink = {
  write: (bytes: Uint8Array) => Promise<void>;
  finish: () => Promise<void>;
  abort: () => Promise<void>;
};

async function createExportSink(fileName: string): Promise<ExportSink> {
  const picker = (
    window as unknown as {
      showSaveFilePicker?: (options: {
        suggestedName: string;
        types: Array<{ description: string; accept: Record<string, string[]> }>;
      }) => Promise<{
        createWritable: () => Promise<FileSystemWritableFileStream>;
      }>;
    }
  ).showSaveFilePicker;
  if (picker) {
    const handle = await picker({
      suggestedName: fileName,
      types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }],
    });
    const writable = await handle.createWritable();
    return {
      write: async (bytes) => writable.write(bytes.slice().buffer),
      finish: async () => writable.close(),
      abort: async () => writable.abort(),
    };
  }

  const root = await navigator.storage?.getDirectory?.();
  if (!root) {
    throw new Error('This browser cannot create a bounded-memory readable export');
  }
  const temporaryName = `agendex-export-${crypto.randomUUID()}.zip`;
  const handle = await root.getFileHandle(temporaryName, { create: true });
  const writable = await handle.createWritable();
  let finished = false;
  return {
    write: async (bytes) => writable.write(bytes.slice().buffer),
    finish: async () => {
      await writable.close();
      finished = true;
      const file = await handle.getFile();
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        void root.removeEntry(temporaryName);
      }, 60_000);
    },
    abort: async () => {
      if (!finished) await writable.abort().catch(() => {});
      await root.removeEntry(temporaryName).catch(() => {});
    },
  };
}

async function writeZipArchive(fileName: string, build: (zip: Zip) => Promise<void>) {
  const sink = await createExportSink(fileName);
  let finish!: () => void;
  let fail!: (error: Error) => void;
  let writes = Promise.resolve();
  const done = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  const zip = new Zip((error, chunk, final) => {
    if (error) return fail(error);
    writes = writes.then(() => sink.write(chunk));
    if (final) writes.then(finish, fail);
  });

  try {
    await build(zip);
    zip.end();
    await done;
    await sink.finish();
  } catch (error) {
    zip.terminate();
    await sink.abort();
    throw error;
  }
}

export function toBackupJsonValue(value: unknown): unknown {
  if (value instanceof ArrayBuffer) return { $bytes: bytesToBase64(value) };
  if (ArrayBuffer.isView(value)) {
    return {
      $bytes: bytesToBase64(
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice(),
      ),
    };
  }
  if (Array.isArray(value)) return value.map((item) => toBackupJsonValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, toBackupJsonValue(item)]),
    );
  }
  return value;
}

export function safeExportPathSegment(value: string): string {
  const normalized = Array.from(value.normalize('NFC').replace(/[\\/]+/g, '_'), (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127 ? '_' : character;
  })
    .join('')
    .trim();
  if (!normalized || normalized === '.' || normalized === '..') return 'file';
  return normalized.slice(0, 180);
}

function stripCryptoMetadata(record: ExportRecord): ExportRecord {
  const clean: ExportRecord = { _id: record._id };
  for (const [key, value] of Object.entries(record)) {
    if (
      key.startsWith('encrypted') ||
      key.endsWith('Token') ||
      key === 'contentToken' ||
      key === 'stableCryptoId' ||
      key === 'keyEpoch' ||
      key === 'url' ||
      key === 'storageId'
    ) {
      continue;
    }
    clean[key] = value;
  }
  return clean;
}

function decryptJson<T>(args: {
  ownerId: string;
  keyEpoch: number;
  table: Parameters<typeof decryptWorkspaceValue>[0]['table'];
  slot: Parameters<typeof decryptWorkspaceValue>[0]['slot'];
  stableCryptoId: string;
  envelope: unknown;
}): T {
  return withWorkspaceKey(args.ownerId, (workspaceKey) =>
    decryptWorkspaceValue<T>({
      workspaceKey,
      workspaceOwnerId: args.ownerId,
      ...args,
    }),
  );
}

async function decryptRecord(
  table: ReadableExportTable,
  record: ExportRecord,
  ownerId: string,
  zip: Zip,
): Promise<ExportRecord> {
  const base = stripCryptoMetadata(record);
  const requireIdentity = () => {
    if (!record.stableCryptoId || !record.keyEpoch) {
      throw new Error(`Encrypted ${table} record is missing its crypto identity`);
    }
    return { stableCryptoId: record.stableCryptoId, keyEpoch: record.keyEpoch };
  };
  if (table === 'plans' && record.encryptedSummary && record.encryptedBody) {
    const identity = requireIdentity();
    return withWorkspaceKey(ownerId, (workspaceKey) => ({
      ...base,
      ...decryptPlanSummary({
        workspaceKey,
        workspaceOwnerId: ownerId,
        ...identity,
        envelope: record.encryptedSummary,
      }),
      content: decryptPlanBody({
        workspaceKey,
        workspaceOwnerId: ownerId,
        ...identity,
        envelope: record.encryptedBody,
      }),
    }));
  }
  if (table === 'planVersions' && record.encryptedSummary && record.encryptedBody) {
    const identity = requireIdentity();
    return withWorkspaceKey(ownerId, (workspaceKey) => ({
      ...base,
      ...decryptPlanSummary({
        workspaceKey,
        workspaceOwnerId: ownerId,
        ...identity,
        envelope: record.encryptedSummary,
        table: 'planVersions',
      }),
      content: decryptPlanBody({
        workspaceKey,
        workspaceOwnerId: ownerId,
        ...identity,
        envelope: record.encryptedBody,
        table: 'planVersions',
      }),
    }));
  }

  const generic = {
    planAnnotations: ['encryptedAnnotation', 'planAnnotations', 'annotation'],
    comments: ['encryptedComment', 'comments', 'comment'],
    planLinks: ['encryptedLink', 'planLinks', 'link'],
    tags: ['encryptedName', 'tags', 'name'],
    plannotatorWritebacks: ['encryptedWriteback', 'plannotatorWritebacks', 'writeback'],
  } as const;
  if (table in generic) {
    const [field, cryptoTable, slot] = generic[table as keyof typeof generic];
    if (record[field]) {
      const identity = requireIdentity();
      Object.assign(
        base,
        decryptJson({
          ownerId,
          keyEpoch: identity.keyEpoch,
          table: cryptoTable,
          slot,
          stableCryptoId: identity.stableCryptoId,
          envelope: record[field],
        }),
      );
    }
  }

  if (table === 'collections' && record.encryptedName) {
    const identity = requireIdentity();
    Object.assign(
      base,
      decryptJson({
        ownerId,
        keyEpoch: identity.keyEpoch,
        table: 'collections',
        slot: 'name',
        stableCryptoId: identity.stableCryptoId,
        envelope: record.encryptedName,
      }),
    );
    if (record.encryptedDescription) {
      Object.assign(
        base,
        decryptJson({
          ownerId,
          keyEpoch: identity.keyEpoch,
          table: 'collections',
          slot: 'description',
          stableCryptoId: identity.stableCryptoId,
          envelope: record.encryptedDescription,
        }),
      );
    }
  }

  if (table === 'daemonHeartbeats') {
    for (const [field, slot, output] of [
      ['encryptedHostname', 'hostname', 'hostname'],
      ['encryptedIpAddress', 'ip', 'ipAddress'],
    ] as const) {
      if (record[field]) {
        const identity = requireIdentity();
        const value = decryptJson<string | { value: string }>({
          ownerId,
          keyEpoch: identity.keyEpoch,
          table: 'daemonHeartbeats',
          slot,
          stableCryptoId: identity.stableCryptoId,
          envelope: record[field],
        });
        base[output] = typeof value === 'string' ? value : value.value;
      }
    }
  }

  if (table === 'comments' && record.encryptedAttachments) {
    const identity = requireIdentity();
    const metadata = decryptJson<
      Array<{ stableCryptoId: string; fileName?: string; contentType: string }>
    >({
      ownerId,
      keyEpoch: identity.keyEpoch,
      table: 'comments',
      slot: 'attachment',
      stableCryptoId: identity.stableCryptoId,
      envelope: record.encryptedAttachments,
    });
    const attachments = [];
    for (const [index, attachment] of (record.attachments ?? []).entries()) {
      const privateMetadata = metadata[index];
      if (!attachment.url || !attachment.stableCryptoId || !attachment.keyEpoch || !privateMetadata)
        continue;
      const { url, stableCryptoId, keyEpoch } = attachment;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Unable to fetch an encrypted export attachment');
      const packed = new Uint8Array(await response.arrayBuffer());
      const bytes = withWorkspaceKey(ownerId, (_workspaceKey, derivedKeys) =>
        openBytes(derivedKeys.contentKey, unpackEncryptedBlob(packed), {
          workspaceOwnerId: ownerId,
          table: 'commentAttachments',
          stableCryptoId,
          slot: 'attachment',
          keyEpoch,
        }),
      );
      const fileName = safeExportPathSegment(privateMetadata.fileName ?? `${index}.bin`);
      const path = `attachments/${safeExportPathSegment(record._id)}/${fileName}`;
      addZipFile(zip, path, bytes);
      bytes.fill(0);
      attachments.push({ ...privateMetadata, path });
    }
    base.attachments = attachments;
  }

  if (table === 'agentAvatars' && record.encrypted && record.url) {
    const identity = requireIdentity();
    const response = await fetch(record.url);
    if (!response.ok) throw new Error('Unable to fetch an encrypted avatar');
    const packed = new Uint8Array(await response.arrayBuffer());
    const bytes = withWorkspaceKey(ownerId, (_workspaceKey, derivedKeys) =>
      openBytes(derivedKeys.contentKey, unpackEncryptedBlob(packed), {
        workspaceOwnerId: ownerId,
        table: 'agentAvatars',
        stableCryptoId: identity.stableCryptoId,
        slot: 'avatar',
        keyEpoch: identity.keyEpoch,
      }),
    );
    const path = `avatars/${safeExportPathSegment(record.agent ?? record._id)}.bin`;
    addZipFile(zip, path, bytes);
    bytes.fill(0);
    base.path = path;
  }

  if (table === 'workspaceInvites') {
    delete base.token;
    delete base.inviteSecretCommitment;
  }
  return base;
}

export async function downloadReadableObfuscationExport(args: {
  convex: ConvexReactClient;
  workspaceOwnerId: string;
}) {
  const fileName = `agendex-readable-export-${new Date().toISOString().slice(0, 10)}.zip`;
  await writeZipArchive(fileName, async (zip) => {
    const account = await args.convex.query(api.workspaceCryptoExport.accountSnapshot, {});
    addZipFile(zip, 'account.json', strToU8(`${JSON.stringify(account, null, 2)}\n`));
    for (const table of READABLE_TABLES) {
      let cursor: string | null = null;
      do {
        const result = (await args.convex.query(api.workspaceCryptoExport.page, {
          table,
          paginationOpts: { cursor, numItems: 25 },
        })) as { page: ExportRecord[]; continueCursor: string; isDone: boolean };
        for (const record of result.page) {
          const readable = await decryptRecord(table, record, args.workspaceOwnerId, zip);
          addZipFile(
            zip,
            `records/${table}/${record._id}.json`,
            strToU8(`${JSON.stringify(readable, null, 2)}\n`),
          );
        }
        cursor = result.isDone ? null : result.continueCursor;
      } while (cursor);
    }
  });
}

async function addEncryptedBlob(args: { zip: Zip; url: string; path: string }): Promise<void> {
  const response = await fetch(args.url);
  if (!response.ok) throw new Error('Unable to fetch encrypted backup content');
  const packed = new Uint8Array(await response.arrayBuffer());
  addZipFile(args.zip, args.path, packed);
  packed.fill(0);
}

async function prepareBackupRecord(
  table: BackupExportTable,
  record: ExportRecord,
  zip: Zip,
): Promise<ExportRecord> {
  const backup = { ...record };
  if (table === 'comments' && Array.isArray(record.attachments)) {
    backup.attachments = [];
    for (const [index, attachment] of record.attachments.entries()) {
      const cleanAttachment = { ...attachment };
      delete cleanAttachment.url;
      if (attachment.url) {
        const path = `encrypted-blobs/commentAttachments/${safeExportPathSegment(record._id)}/${index}.bin`;
        await addEncryptedBlob({ zip, url: attachment.url, path });
        Object.assign(cleanAttachment, { encryptedBlobPath: path });
      }
      backup.attachments.push(cleanAttachment);
    }
  }
  if (table === 'agentAvatars' && record.url) {
    const path = `encrypted-blobs/agentAvatars/${safeExportPathSegment(record._id)}.bin`;
    await addEncryptedBlob({ zip, url: record.url, path });
    backup.encryptedBlobPath = path;
  }
  delete backup.url;
  return backup;
}

export async function downloadEncryptedObfuscationBackup(args: {
  convex: ConvexReactClient;
  workspaceOwnerId: string;
}) {
  const exportedAt = new Date();
  const fileName = `agendex-encrypted-backup-${exportedAt.toISOString().slice(0, 10)}.zip`;
  await writeZipArchive(fileName, async (zip) => {
    const account = await args.convex.query(api.workspaceCryptoExport.accountSnapshot, {});
    const manifest = {
      format: 'agendex-obfuscation-backup-v1',
      exportedAt: exportedAt.toISOString(),
      workspaceOwnerId: args.workspaceOwnerId,
      warning:
        'Sensitive workspace fields and blobs remain encrypted. Account and service metadata remain plaintext.',
      byteEncoding: 'Objects shaped as {$bytes: string} contain canonical base64.',
    };
    addZipFile(zip, 'manifest.json', strToU8(`${JSON.stringify(manifest, null, 2)}\n`));
    addZipFile(
      zip,
      'account.json',
      strToU8(`${JSON.stringify(toBackupJsonValue(account), null, 2)}\n`),
    );

    for (const table of BACKUP_TABLES) {
      let cursor: string | null = null;
      do {
        const result = (await args.convex.query(api.workspaceCryptoExport.page, {
          table,
          paginationOpts: { cursor, numItems: 25 },
        })) as { page: ExportRecord[]; continueCursor: string; isDone: boolean };
        for (const record of result.page) {
          const backup = await prepareBackupRecord(table, record, zip);
          addZipFile(
            zip,
            `records/${table}/${safeExportPathSegment(record._id)}.json`,
            strToU8(`${JSON.stringify(toBackupJsonValue(backup), null, 2)}\n`),
          );
        }
        cursor = result.isDone ? null : result.continueCursor;
      } while (cursor);
    }
  });
}
