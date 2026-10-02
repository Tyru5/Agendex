import { expect, test } from 'bun:test';
import { requestPlanRead } from './plan-read-session.ts';
import type { PlanReadSource } from './plan-read-context.tsx';
import type { Plan } from './api.ts';
import type { PlanReadResult } from '@agendex/shared/plan-read';
const plan = { id: 'p', title: 'Plan', content: 'Steps' } as Plan;
const result: PlanReadResult = { baseline: null, reason: 'first-read' };

test('stalled reads expire and a later opening retries rather than reusing a stuck promise', async () => {
  let calls = 0;
  let finish!: (value: PlanReadResult) => void;
  const source: PlanReadSource = {
    scope: 'timeout',
    open: () => {
      calls++;
      return calls === 1
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(result);
    },
    clear: async () => undefined,
  };
  const first = requestPlanRead('timeout-key', source, plan, 5);
  expect(requestPlanRead('timeout-key', source, plan, 5)).toBe(first);
  await Bun.sleep(15);
  expect(await requestPlanRead('timeout-key', source, plan, 5)).toEqual(result);
  expect(calls).toBe(2);
  finish(result);
  expect(await first).toEqual(result);
});

test('a slow successful read still delivers its comparison after coalescing expires', async () => {
  let finish!: (value: PlanReadResult) => void;
  const source: PlanReadSource = {
    open: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    clear: async () => undefined,
  };
  const comparison: PlanReadResult = {
    baseline: { title: 'Old plan', content: 'Old steps', updatedAt: '2026-01-01' },
    reason: 'available',
  };
  const request = requestPlanRead('slow-success', source, plan, 5);
  await Bun.sleep(15);
  finish(comparison);
  expect(await request).toEqual(comparison);
});

test('an expired request settling cannot evict a newer pending read', async () => {
  const finishes: Array<(value: PlanReadResult) => void> = [];
  const source: PlanReadSource = {
    open: () =>
      new Promise((resolve) => {
        finishes.push(resolve);
      }),
    clear: async () => undefined,
  };
  const first = requestPlanRead('overlapping', source, plan, 5);
  await Bun.sleep(15);
  const second = requestPlanRead('overlapping', source, plan);
  finishes[0]?.(result);
  await first;
  expect(requestPlanRead('overlapping', source, plan)).toBe(second);
  finishes[1]?.(result);
  await second;
});
test('settled reads never replay an earlier comparison on a later visit', async () => {
  let calls = 0;
  const source: PlanReadSource = {
    scope: 'settled',
    open: async () => {
      calls++;
      return result;
    },
    clear: async () => undefined,
  };
  expect(await requestPlanRead('settled-key', source, plan)).toEqual(result);
  expect(await requestPlanRead('settled-key', source, plan)).toEqual(result);
  expect(calls).toBe(2);
});
