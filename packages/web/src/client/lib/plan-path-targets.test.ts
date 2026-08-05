import { describe, expect, test } from 'bun:test';
import type { Plan } from './api.ts';
import {
  planPathTargetKey,
  remoteTargetForPlanPath,
  remoteTargetsForPlanPaths,
} from './plan-path-targets.ts';

function cloudPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'cloud-plan',
    localPlanId: 'local-plan',
    agent: 'codex',
    title: 'Plan',
    content: '',
    filePath: '/repo/plans/plan.md',
    format: 'md',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    workspace: '/repo',
    metadata: {
      git: {
        branch: 'feat/source-links',
        commit: 'abc1234',
        repo: {
          host: 'github.com',
          owner: 'acme',
          name: 'widgets',
          webUrl: 'https://github.com/acme/widgets',
        },
      },
    },
    ...overrides,
  };
}

describe('remoteTargetForPlanPath', () => {
  test('links relative paths at the synced commit and line range', () => {
    expect(
      remoteTargetForPlanPath(cloudPlan(), {
        path: 'packages/web/src/App.tsx',
        line: 12,
        lineEnd: 18,
      }),
    ).toEqual({
      label: 'Open on GitHub',
      url: 'https://github.com/acme/widgets/blob/abc1234/packages/web/src/App.tsx#L12-L18',
    });
  });

  test('strips the workspace from absolute paths', () => {
    expect(
      remoteTargetForPlanPath(cloudPlan(), { path: '/repo/packages/shared/src/git.ts' })?.url,
    ).toBe('https://github.com/acme/widgets/blob/abc1234/packages/shared/src/git.ts');
  });

  test('falls back to the branch for legacy metadata without a commit', () => {
    const plan = cloudPlan({
      workspace: undefined,
      metadata: {
        git: {
          branch: 'feat/source-links',
          remoteUrl: 'git@github.com:acme/widgets.git',
        },
      },
    });
    expect(remoteTargetForPlanPath(plan, { path: 'src/App.tsx' })?.url).toBe(
      'https://github.com/acme/widgets/blob/feat/source-links/src/App.tsx',
    );
  });

  test('rejects absolute paths outside the synced workspace and traversal', () => {
    expect(remoteTargetForPlanPath(cloudPlan(), { path: '/other/repo/src/App.tsx' })).toBeNull();
    expect(remoteTargetForPlanPath(cloudPlan(), { path: '../secrets.env' })).toBeNull();
  });

  test('returns null without usable git metadata', () => {
    expect(
      remoteTargetForPlanPath(cloudPlan({ metadata: {} }), { path: 'src/App.tsx' }),
    ).toBeNull();
  });
});

test('remoteTargetsForPlanPaths keeps distinct line targets for the same path', () => {
  const first = { path: 'src/App.tsx', line: 10 };
  const second = { path: 'src/App.tsx', line: 20 };
  const targets = remoteTargetsForPlanPaths(cloudPlan(), [first, second]);
  expect(targets[planPathTargetKey(first)]?.url).toEndWith('#L10');
  expect(targets[planPathTargetKey(second)]?.url).toEndWith('#L20');
});
