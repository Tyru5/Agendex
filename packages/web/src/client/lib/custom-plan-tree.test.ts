import { expect, test } from 'bun:test';
import type { Plan } from './api.ts';
import { buildCustomDirTree, splitCustomDirPlans } from './custom-plan-tree.ts';

const nestedPlan: Plan = {
  id: 'plan-1',
  agent: 'custom',
  title: 'Roadmap',
  content: '# Roadmap',
  filePath: '/custom/nested/roadmap.md',
  format: 'md',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  metadata: {
    source: 'custom-dir',
    customDir: '/custom',
  },
};

test('Given configured sources with and without plans When building the tree Then every source is represented', () => {
  const tree = buildCustomDirTree([nestedPlan], ['/empty', '/custom']);

  expect(tree).toEqual([
    {
      type: 'dir',
      key: '/custom',
      name: 'custom',
      children: [
        {
          type: 'dir',
          key: '/custom/nested',
          name: 'nested',
          children: [
            {
              type: 'file',
              key: nestedPlan.id,
              name: 'roadmap.md',
              plan: nestedPlan,
            },
          ],
        },
      ],
    },
    {
      type: 'dir',
      key: '/empty',
      name: 'empty',
      children: [],
    },
  ]);
});

test('Given equivalent separator styles When building source roots Then the source is represented once', () => {
  const tree = buildCustomDirTree([], ['C:\\plans\\', 'C:/plans']);

  expect(tree).toEqual([
    {
      type: 'dir',
      key: 'C:/plans',
      name: 'plans',
      children: [],
    },
  ]);
});

test('Given an ordered list When splitting by source Then custom-source plans keep their place in it', () => {
  const regular = (id: string): Plan => ({ ...nestedPlan, id, agent: 'claude', metadata: {} });
  const plans = [regular('a'), { ...nestedPlan, id: 'custom-b' }, regular('c')];

  const grouped = splitCustomDirPlans(plans);
  expect(grouped.customDirPlans.map((plan) => plan.id)).toEqual(['custom-b']);
  expect(grouped.nonCustomPlans.map((plan) => plan.id)).toEqual(['a', 'c']);

  const ordered = splitCustomDirPlans(plans, { ordered: true });
  expect(ordered.customDirPlans).toEqual([]);
  expect(ordered.nonCustomPlans.map((plan) => plan.id)).toEqual(['a', 'custom-b', 'c']);
});
