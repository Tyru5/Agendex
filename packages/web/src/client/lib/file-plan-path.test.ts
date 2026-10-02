import { expect, test } from 'bun:test';
import { filePlanQueryPath } from './file-plan-path.ts';
import { filePlanSearchQuery, parseFilePlanQuery } from './file-plan-query.ts';

test('path chip counts and navigation resolve explicit relative mentions from the plan directory', () => {
  const plan = { workspace: '/repo', filePath: '/repo/plans/feature.md' };
  expect(filePlanQueryPath('../src/auth.ts', plan)).toBe('src/auth.ts');
  expect(filePlanQueryPath('./src/local.ts', plan)).toBe('plans/src/local.ts');
  const query = filePlanSearchQuery(filePlanQueryPath('../src/my auth.ts', plan));
  expect(parseFilePlanQuery(query).files).toEqual(['src/my auth.ts']);
  expect(filePlanQueryPath('src/auth.ts', plan)).toBe('src/auth.ts');
});

test('local explicit siblings preserve a repository-confined absolute lookup target', () => {
  expect(
    filePlanQueryPath('../../package-b/auth.ts', {
      workspace: '/repo/package-a',
      filePath: '/repo/package-a/plans/feature.md',
    }),
  ).toBe('/repo/package-b/auth.ts');
});

test('global stores and missing source contexts keep workspace lookup semantics', () => {
  expect(
    filePlanQueryPath('./src/a.ts', {
      workspace: '/repo',
      filePath: '/home/me/.claude/plans/a.md',
    }),
  ).toBe('./src/a.ts');
  expect(filePlanQueryPath('./src/a.ts', { workspace: '/repo' })).toBe('./src/a.ts');
  expect(filePlanQueryPath('../src/a.ts', { filePath: '/repo/plans/a.md' })).toBe('../src/a.ts');
});

test('Windows source directories resolve line-free query identities portably', () => {
  expect(
    filePlanQueryPath('..\\src\\auth.ts', {
      workspace: 'C:\\repo',
      filePath: 'C:\\repo\\plans\\feature.md',
    }),
  ).toBe('src/auth.ts');
});
