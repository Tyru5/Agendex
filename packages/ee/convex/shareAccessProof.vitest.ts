/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

async function legacyPasswordHash(password: string): Promise<string> {
  const salt = 'fixed-salt';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + password));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${salt}:${hex}`;
}

async function setup() {
  const t = convexTest(schema, modules);
  const passwordHash = await legacyPasswordHash('hunter2');
  const shareLinkId = await t.run(async (ctx) => {
    const now = Date.now();
    const planId = await ctx.db.insert('plans', {
      ownerId: 'owner',
      agent: 'claude',
      title: 'Protected share',
      content: '# Plan\n\nBody',
      format: 'markdown',
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    return await ctx.db.insert('shareLinks', {
      planId,
      token: 'protected-token',
      createdBy: 'owner',
      createdAt: now,
      passwordHash,
    });
  });
  return { t, shareLinkId };
}

test('password unlock issues an id+secret credential and only the full credential authorizes', async () => {
  const { t } = await setup();
  const { accessProof } = await t.action(api.sharing.getSharedPlanWithPassword, {
    token: 'protected-token',
    password: 'hunter2',
  });

  const [proofId, secret] = accessProof.split('.');
  expect(proofId).toBeTruthy();
  expect(secret?.length).toBeGreaterThanOrEqual(43);

  const stored = await t.run((ctx) => ctx.db.query('shareAccessProofs').collect());
  expect(stored).toHaveLength(1);
  expect(stored[0]?.secretHash).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.stringify(stored)).not.toContain(secret);

  await expect(
    t.query(api.plans.getPlanByShareToken, { token: 'protected-token', accessProof }),
  ).resolves.toMatchObject({ title: 'Protected share' });

  for (const forged of [String(proofId), `${proofId}.not-the-secret`]) {
    await expect(
      t.query(api.plans.getPlanByShareToken, { token: 'protected-token', accessProof: forged }),
    ).resolves.toEqual({ passwordRequired: true });
  }
});

test('revoked links resolve to an explicit unavailable state instead of throwing', async () => {
  const { t, shareLinkId } = await setup();
  await t.run((ctx) => ctx.db.delete(shareLinkId));

  await expect(
    t.query(api.plans.getPlanByShareToken, { token: 'protected-token' }),
  ).resolves.toEqual({ unavailable: true, reason: 'revoked' });
  await expect(
    t.query(api.agentAvatars.listAgentAvatarsForShare, { token: 'protected-token' }),
  ).resolves.toEqual({});
});
