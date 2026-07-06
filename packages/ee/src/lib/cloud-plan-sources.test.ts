import { expect, test } from 'bun:test';
import type { Plan } from '@agendex/web';
import { getCloudCustomPlanSources } from './cloud-plan-sources.ts';

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
