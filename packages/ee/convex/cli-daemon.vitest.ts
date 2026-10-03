/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

test('anonymous heartbeats have removable IDs; deletion is owner-scoped and idempotent', async () => {
  const t = convexTest(schema, modules);
  const { anonymous, alive, foreign } = await t.run(async (ctx) => ({
    anonymous: await ctx.db.insert('daemonHeartbeats', {
      ownerId: 'alice',
      lastSeenAt: Date.now() - 300_000,
    }),
    alive: await ctx.db.insert('daemonHeartbeats', {
      ownerId: 'alice',
      deviceId: 'active',
      lastSeenAt: Date.now(),
    }),
    foreign: await ctx.db.insert('daemonHeartbeats', {
      ownerId: 'bob',
      lastSeenAt: Date.now() - 300_000,
    }),
  }));
  const devices = await t.query(internal.cli.getDaemonHeartbeats, { ownerId: 'alice' });
  expect(devices.find((device) => device.deviceId === null)).toMatchObject({
    recordId: anonymous,
    hostname: null,
    pid: null,
  });
  expect(
    await t.mutation(internal.cli.deleteDaemons, {
      ownerId: 'alice',
      deviceIds: [],
      recordIds: [anonymous, foreign, anonymous, 'invalid-id'],
    }),
  ).toEqual({ deleted: 1 });
  expect(await t.run((ctx) => ctx.db.get(anonymous))).toBeNull();
  expect(await t.run((ctx) => ctx.db.get(alive))).not.toBeNull();
  expect(await t.run((ctx) => ctx.db.get(foreign))).not.toBeNull();
});

test('legacy device-ID deletion remains supported and owner-scoped', async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (const ownerId of ['bob', 'alice']) {
      await ctx.db.insert('daemonHeartbeats', {
        ownerId,
        deviceId: 'shared-device-id',
        lastSeenAt: Date.now(),
      });
    }
  });
  expect(
    await t.mutation(internal.cli.deleteDaemons, {
      ownerId: 'alice',
      deviceIds: ['shared-device-id'],
    }),
  ).toEqual({ deleted: 1 });
  expect(await t.query(internal.cli.getDaemonHeartbeats, { ownerId: 'alice' })).toEqual([]);
  expect(await t.query(internal.cli.getDaemonHeartbeats, { ownerId: 'bob' })).toHaveLength(1);
});

test('heartbeats persist launcher and platform for multi-machine status', async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.cli.upsertHeartbeat, {
    ownerId: 'alice',
    deviceId: 'windows-device',
    hostname: 'yeet',
    launcher: 'desktop',
    platform: 'win32',
  });
  await t.mutation(internal.cli.upsertHeartbeat, {
    ownerId: 'alice',
    deviceId: 'legacy-device',
    hostname: 'oldbox',
  });

  const devices = await t.query(internal.cli.getDaemonHeartbeats, { ownerId: 'alice' });
  expect(devices.find((device) => device.deviceId === 'windows-device')).toMatchObject({
    hostname: 'yeet',
    launcher: 'desktop',
    platform: 'win32',
  });
  expect(devices.find((device) => device.deviceId === 'legacy-device')).toMatchObject({
    launcher: null,
    platform: null,
  });

  await t.mutation(internal.cli.upsertHeartbeat, {
    ownerId: 'alice',
    deviceId: 'windows-device',
    launcher: 'cli',
  });
  const updated = await t.query(internal.cli.getDaemonHeartbeats, { ownerId: 'alice' });
  expect(updated.find((device) => device.deviceId === 'windows-device')).toMatchObject({
    launcher: 'cli',
    platform: 'win32',
  });
});
