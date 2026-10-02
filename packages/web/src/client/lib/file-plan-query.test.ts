import { expect, test } from 'bun:test';
import { filePlanSearchQuery, parseFilePlanQuery } from './file-plan-query.ts';
import { filterPlans } from './plan-search.ts';
import type { Plan } from './api.ts';

test('file queries support quoted paths, multiple filters and ordinary text', () => {
  expect(parseFilePlanQuery('auth FILE:"src/auth flow.ts" file:src/a.ts file:src/a.ts')).toEqual({
    files: ['src/auth flow.ts', 'src/a.ts'],
    text: 'auth',
  });
  expect(parseFilePlanQuery('"file:src/a.ts"')).toEqual({ files: [], text: '"file:src/a.ts"' });
  expect(parseFilePlanQuery('profile:auth')).toEqual({ files: [], text: 'profile:auth' });
});

test('file queries reject empty and unterminated paths', () => {
  for (const query of ['file:', 'file:""', 'file:"src/a b.ts']) {
    expect(parseFilePlanQuery(query).error).toBeDefined();
  }
});

test('file filtering intersects provenance results with ordinary text', () => {
  const plans: Plan[] = ['auth', 'other'].map((id) => ({
    id,
    title: id,
    agent: 'codex',
    content: '',
    workspace: '/repo',
    filePath: `/plans/${id}.md`,
    createdAt: '',
    updatedAt: '',
    format: 'markdown',
    metadata: {},
  }));
  expect(
    filterPlans(plans, 'file:src/a.ts', undefined, new Set(['other'])).map((plan) => plan.id),
  ).toEqual(['other']);
  expect(
    filterPlans(plans, 'file:src/a.ts auth', undefined, new Set(['auth', 'other'])).map(
      (plan) => plan.id,
    ),
  ).toEqual(['auth']);
  expect(filterPlans(plans, 'file:src/a.ts', undefined, new Set())).toEqual([]);
});

test('path-chip navigation produces quoted file syntax without losing workspace-relative spaces', () => {
  expect(parseFilePlanQuery(filePlanSearchQuery('src/my auth.ts'))).toEqual({
    files: ['src/my auth.ts'],
    text: '',
  });
  expect(
    parseFilePlanQuery(Array.from({ length: 9 }, (_, i) => `file:src/${i}.ts`).join(' ')).error,
  ).toBe('Use at most 8 file filters.');
});

test('invalid file filter lengths and controls are rejected before server queries', () => {
  expect(parseFilePlanQuery(`file:${'a'.repeat(1025)}.ts`).error).toBeDefined();
  expect(parseFilePlanQuery('file:a\0.ts').error).toBeDefined();
});
