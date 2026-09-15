import { afterEach, expect, spyOn, test } from 'bun:test';
import {
  decryptPlanSummary,
  decryptWorkspaceValue,
  deriveWorkspaceKeys,
  encryptWorkspaceValue,
  sealText,
} from '@agendex/shared/crypto';
import { Zip } from 'fflate';
import type { ConvexReactClient } from 'convex/react';
import { getFunctionName } from 'convex/server';
import { encryptRows, runWorkspaceSeal, sealBlobRows } from './obfuscation-seal.ts';
import { decryptRecord } from './readable-obfuscation-export.ts';
import { lockAllWorkspaceKeys, unlockWorkspaceKey } from './obfuscation-keyring.ts';

const owner = 'seal-test-owner';
const key = new Uint8Array(32).fill(7);
const oldKey = new Uint8Array(32).fill(8);
afterEach(() => lockAllWorkspaceKeys());

test('sealing existing metadata produces the same value format as normal writes and exports', async () => {
  unlockWorkspaceKey(owner, 1, key, false);
  const zip = new Zip(() => {});
  const tag = encryptRows('tags', [{ _id: 'tag', name: 'Private Tag' }], key, owner, 1)[0];
  if (!tag) throw new Error('Expected a sealed tag');
  const collection = encryptRows(
    'collections',
    [{ _id: 'collection', name: 'Collection', description: 'Private description' }],
    key,
    owner,
    1,
  )[0];
  if (!collection) throw new Error('Expected a sealed collection');
  const comment = encryptRows(
    'comments',
    [
      {
        _id: 'comment',
        authorName: 'Owner',
        body: 'Private body',
        attachments: [{ fileName: 'private.txt', contentType: 'text/plain', size: 3 }],
      },
    ],
    key,
    owner,
    1,
  )[0];
  if (!comment) throw new Error('Expected a sealed comment');
  const read = (
    row: Record<string, unknown>,
    table: 'tags' | 'collections' | 'comments',
    slot: 'name' | 'description' | 'attachment',
    field: string,
  ) =>
    decryptWorkspaceValue({
      workspaceKey: key,
      workspaceOwnerId: owner,
      keyEpoch: 1,
      table,
      slot,
      stableCryptoId: String(row.stableCryptoId),
      envelope: row[field],
    });
  expect(read(tag, 'tags', 'name', 'encryptedName')).toEqual({ name: 'Private Tag' });
  expect(read(collection, 'collections', 'name', 'encryptedName')).toEqual({ name: 'Collection' });
  expect(read(collection, 'collections', 'description', 'encryptedDescription')).toEqual({
    description: 'Private description',
  });
  expect(read(comment, 'comments', 'attachment', 'encryptedAttachments')).toEqual([
    { fileName: 'private.txt', contentType: 'text/plain', size: 3 },
  ]);
  expect((await decryptRecord('tags', { ...tag, _id: 'tag' }, owner, zip)).name).toBe(
    'Private Tag',
  );
  expect(
    (await decryptRecord('collections', { ...collection, _id: 'collection' }, owner, zip))
      .description,
  ).toBe('Private description');
  zip.terminate();
});

test('legacy version summaries without a local plan identity remain readable but plan summaries reject it', async () => {
  unlockWorkspaceKey(owner, 1, key, false);
  const version = encryptRows(
    'planVersions',
    [{ _id: 'version', title: 'Historical title', content: 'Historical body' }],
    key,
    owner,
    1,
  )[0];
  if (!version) throw new Error('Expected a sealed version');
  expect(
    decryptPlanSummary({
      workspaceKey: key,
      workspaceOwnerId: owner,
      keyEpoch: 1,
      stableCryptoId: String(version.stableCryptoId),
      table: 'planVersions',
      envelope: version.encryptedSummary,
    }).title,
  ).toBe('Historical title');
  const zip = new Zip(() => {});
  expect(
    (await decryptRecord('planVersions', { ...version, _id: 'version' }, owner, zip)).content,
  ).toBe('Historical body');
  zip.terminate();
  const envelope = sealText(
    deriveWorkspaceKeys(key).contentKey,
    JSON.stringify({ title: 'Missing identity' }),
    {
      workspaceOwnerId: owner,
      keyEpoch: 1,
      stableCryptoId: 'plan',
      table: 'plans',
      slot: 'summary',
    },
  );
  expect(() =>
    decryptPlanSummary({
      workspaceKey: key,
      workspaceOwnerId: owner,
      keyEpoch: 1,
      stableCryptoId: 'plan',
      envelope,
    }),
  ).toThrow('local identity');
});

test('readable export decrypts raw text heartbeat envelopes', async () => {
  unlockWorkspaceKey(owner, 1, key, false);
  const heartbeat = encryptRows(
    'daemonHeartbeats',
    [{ _id: 'heartbeat', hostname: 'private-host', ipAddress: '192.168.1.2' }],
    key,
    owner,
    1,
  )[0];
  if (!heartbeat) throw new Error('Expected a sealed heartbeat');
  const zip = new Zip(() => {});
  const record = await decryptRecord(
    'daemonHeartbeats',
    { ...heartbeat, _id: 'heartbeat' },
    owner,
    zip,
  );
  expect(record.hostname).toBe('private-host');
  expect(record.ipAddress).toBe('192.168.1.2');
  zip.terminate();
});

test('initial sealing preserves encrypted optional fields on concurrent current-epoch writes', () => {
  const sealedCollections = encryptRows(
    'collections',
    [{ _id: 'collection', name: 'Name', description: 'Keep this description' }],
    key,
    owner,
    1,
  );
  const collection = sealedCollections[0];
  if (!collection) throw new Error('Expected sealed collection');
  const resealedCollection = encryptRows(
    'collections',
    [{ ...collection, _id: 'collection', name: '' }],
    key,
    owner,
    1,
  )[0];
  expect(resealedCollection?.encryptedDescription).toEqual(collection.encryptedDescription);
  const heartbeat = encryptRows(
    'daemonHeartbeats',
    [{ _id: 'heartbeat', hostname: 'keep-host', ipAddress: '192.168.1.2' }],
    key,
    owner,
    1,
  )[0];
  if (!heartbeat) throw new Error('Expected sealed heartbeat');
  const resealedHeartbeat = encryptRows(
    'daemonHeartbeats',
    [{ ...heartbeat, _id: 'heartbeat' }],
    key,
    owner,
    1,
  )[0];
  expect(resealedHeartbeat?.encryptedHostname).toEqual(heartbeat.encryptedHostname);
  expect(resealedHeartbeat?.encryptedIpAddress).toEqual(heartbeat.encryptedIpAddress);
});

test('a resumed seal runner creates its own lease instead of reusing a queried lease', async () => {
  const leases: string[] = [];
  const convex = {
    mutation: async (
      reference: Parameters<typeof getFunctionName>[0],
      args: { leaseId: string },
    ) => {
      if (getFunctionName(reference).endsWith(':claimWorkspaceCryptoLease')) {
        leases.push(args.leaseId);
        throw new Error('Another device is sealing this workspace');
      }
    },
  } as unknown as ConvexReactClient;
  const args = {
    convex,
    workspaceOwnerId: owner,
    keyEpoch: 1,
    operation: { id: 'operation', phase: 'tags', processed: 0, leaseId: 'another-tab-lease' },
  };
  await expect(runWorkspaceSeal(args)).rejects.toThrow('Another device');
  await expect(runWorkspaceSeal(args)).rejects.toThrow('Another device');
  expect(leases).toHaveLength(2);
  expect(leases[0]).not.toBe('another-tab-lease');
  expect(leases[1]).not.toBe(leases[0]);
});

test('rotation handles a page mixing previous and active epoch rows and rejects relabelled envelopes', () => {
  const row = (workspaceKey: Uint8Array, epoch: number, id: string) => {
    const encrypted = encryptWorkspaceValue({
      workspaceKey,
      workspaceOwnerId: owner,
      keyEpoch: epoch,
      table: 'tags',
      slot: 'name',
      stableCryptoId: id,
      value: { name: 'Mixed Case' },
    });
    return { _id: id, keyEpoch: epoch, stableCryptoId: id, encryptedName: encrypted.envelope };
  };
  const older = row(oldKey, 1, 'older');
  const current = row(key, 2, 'current');
  const rotated = encryptRows('tags', [older, current], key, owner, 2, oldKey);
  for (const item of rotated) {
    expect(
      decryptWorkspaceValue<{ name: string }>({
        workspaceKey: key,
        workspaceOwnerId: owner,
        keyEpoch: 2,
        table: 'tags',
        slot: 'name',
        stableCryptoId: String(item.stableCryptoId),
        envelope: item.encryptedName,
      }),
    ).toEqual({ name: 'Mixed Case' });
  }
  expect(rotated).toHaveLength(2);
  expect(rotated[0]?.nameToken).toBe(rotated[1]?.nameToken);
  expect(() => encryptRows('tags', [{ ...older, keyEpoch: 2 }], key, owner, 2, oldKey)).toThrow();
});

test('resuming a partially committed blob rotation skips blobs already at the active epoch', async () => {
  let mutations = 0;
  const convex = {
    mutation: async () => {
      mutations++;
      throw new Error('Already rotated blob must not be uploaded again');
    },
  } as unknown as ConvexReactClient;
  const base = {
    convex,
    leaseId: 'lease',
    workspaceOwnerId: owner,
    keyEpoch: 2,
    sourceWorkspaceKey: oldKey,
  };
  expect(
    await sealBlobRows({
      ...base,
      phase: 'attachments',
      rows: [{ _id: 'comment', attachments: [{ encrypted: true, keyEpoch: 2 }] }],
    }),
  ).toBe(0);
  expect(
    await sealBlobRows({
      ...base,
      phase: 'avatars',
      rows: [{ _id: 'avatar', encrypted: true, keyEpoch: 2 }],
    }),
  ).toBe(0);
  expect(mutations).toBe(0);
});

for (const loseLease of [false, true]) {
  test(`sealing renews its lease during a delayed page and ${loseLease ? 'stops on lease loss' : 'cleans up after completion'}`, async () => {
    unlockWorkspaceKey(owner, 1, key, false);
    let tick: (() => void) | undefined;
    const timer = spyOn(globalThis, 'setInterval').mockImplementation(((callback: () => void) => {
      tick = callback;
      return 123;
    }) as typeof setInterval);
    const clear = spyOn(globalThis, 'clearInterval').mockImplementation(() => {});
    const mutations: string[] = [];
    const convex = {
      mutation: async (reference: Parameters<typeof getFunctionName>[0]) => {
        const name = getFunctionName(reference);
        mutations.push(name);
        if (name.endsWith(':heartbeatWorkspaceCryptoLease') && loseLease)
          throw new Error('Obfuscation lease was lost');
      },
      query: async (reference: Parameters<typeof getFunctionName>[0]) => {
        if (getFunctionName(reference).endsWith(':getWorkspaceCryptoStatus'))
          return { settings: null };
        // Advance the renewal timer while the page request is still outstanding.
        if (!tick) throw new Error('Expected an active renewal timer');
        tick();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        return { page: [], continueCursor: '', isDone: true };
      },
    } as unknown as ConvexReactClient;
    try {
      const result = runWorkspaceSeal({
        convex,
        workspaceOwnerId: owner,
        keyEpoch: 1,
        operation: { id: 'operation', phase: 'tags', processed: 0 },
      });
      if (loseLease) await expect(result).rejects.toThrow('lease was lost');
      else expect(await result).toBe('sealed');
      expect(mutations).toContain('workspaceCrypto:heartbeatWorkspaceCryptoLease');
      expect(mutations.includes('workspaceCryptoSeal:sealTagsBatch')).toBe(!loseLease);
      expect(clear).toHaveBeenCalledWith(123);
    } finally {
      timer.mockRestore();
      clear.mockRestore();
    }
  });
}
