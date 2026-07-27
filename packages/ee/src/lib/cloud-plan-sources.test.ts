import { expect, test } from 'bun:test';
import type { Plan } from '@agendex/web';
import {
  deletePlansInBatches,
  findCloudCustomPlanSource,
  getCloudCustomPlanSources,
  isConfiguredPlanSourcePath,
} from './cloud-plan-sources.ts';

function plan(id: string, customDir: string | undefined): Plan {
  return {
    id,
    agent: 'codex',
    title: `Plan ${id}`,
    content: '',
    filePath: customDir ? `${customDir}/plan-${id}.md` : `/other/plan-${id}.md`,
    format: 'md',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    metadata: customDir ? { source: 'custom-dir', customDir } : { source: 'adapter' },
  };
}

test('Given cloud plans When grouping custom sources Then only custom-dir metadata becomes sources', () => {
  const sources = getCloudCustomPlanSources([
    plan('a', '/tmp/alpha/'),
    plan('b', '/tmp/alpha'),
    plan('c', '/tmp/beta'),
    plan('d', undefined),
  ]);

  expect(sources).toHaveLength(2);
  expect(sources[0]?.path).toBe('/tmp/alpha');
  expect(sources[0]?.label).toBe('alpha');
  expect(sources[0]?.plans.map((sourcePlan) => sourcePlan.id)).toEqual(['a', 'b']);
  expect(sources[1]?.path).toBe('/tmp/beta');
  expect(sources[1]?.plans.map((sourcePlan) => sourcePlan.id)).toEqual(['c']);
});

test('Given a Windows customDir When finding a cloud source by sidebar key Then separators and trailing slashes are tolerated', () => {
  const plans = [
    plan('a', 'C:\\Users\\Tyrus\\iris\\auto-sessions'),
    plan('b', 'C:\\Users\\Tyrus\\iris\\auto-sessions\\'),
    plan('c', '/tmp/beta'),
  ];

  const source = findCloudCustomPlanSource(plans, 'C:/Users/Tyrus/iris/auto-sessions');
  expect(source?.plans.map((sourcePlan) => sourcePlan.id)).toEqual(['a', 'b']);
  expect(findCloudCustomPlanSource(plans, 'C:\\Users\\Tyrus\\iris\\auto-sessions\\')?.path).toBe(
    'C:/Users/Tyrus/iris/auto-sessions',
  );
});

test('Given no matching cloud plans When finding a cloud source Then undefined is returned', () => {
  expect(findCloudCustomPlanSource([plan('a', '/tmp/alpha')], '/tmp/beta')).toBeUndefined();
  expect(findCloudCustomPlanSource([plan('a', undefined)], '/tmp/alpha')).toBeUndefined();
  expect(findCloudCustomPlanSource([], '')).toBeUndefined();
});

test('Given locally configured dirs When checking a normalized sidebar key Then raw Windows paths match', () => {
  const dirs = ['C:\\Users\\Tyrus\\iris\\auto-sessions', '/home/tyrus/plans/'];

  expect(isConfiguredPlanSourcePath(dirs, 'C:/Users/Tyrus/iris/auto-sessions')).toBe(true);
  expect(isConfiguredPlanSourcePath(dirs, '/home/tyrus/plans')).toBe(true);
  expect(isConfiguredPlanSourcePath(dirs, 'C:/Users/Tyrus/iris/other')).toBe(false);
  expect(isConfiguredPlanSourcePath([], 'C:/Users/Tyrus/iris/auto-sessions')).toBe(false);
  expect(isConfiguredPlanSourcePath(dirs, '')).toBe(false);
});

test('Given many plan ids When deleting in batches Then all delete with at most five in flight', async () => {
  const ids = Array.from({ length: 12 }, (_, i) => `plan-${i}`);
  const deleted: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let progress = 0;

  await deletePlansInBatches(
    ids,
    async (planId) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      deleted.push(planId);
      inFlight -= 1;
    },
    () => {
      progress += 1;
    },
  );

  expect(deleted.toSorted()).toEqual(ids.toSorted());
  expect(maxInFlight).toBeLessThanOrEqual(5);
  expect(progress).toBe(12);
});

test('Given a failing deletion When deleting in batches Then the error propagates', async () => {
  await expect(
    deletePlansInBatches(['a', 'b'], async (planId) => {
      if (planId === 'b') throw new Error('delete failed');
    }),
  ).rejects.toThrow('delete failed');
});
