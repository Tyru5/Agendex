import { describe, expect, test } from 'bun:test';
import type { FilePlanHistory } from '@agendex/shared/file-plan-history';
import { loadFilePlanMatches } from './file-plan-loader.ts';
const page = (ids: string[], total: number, offset = 0): FilePlanHistory => ({
  path: 'src/auth.ts',
  workspace: '/repo',
  total,
  offset,
  limit: 100,
  plans: ids.map((id) => ({
    id,
    title: id,
    agent: 'omp',
    filePath: '/repo/plan.md',
    createdAt: '',
    updatedAt: '',
    mentioned: true,
    changedByPlanCommits: false,
    receipt: null,
  })),
});
describe('file filter loading', () => {
  test('walks beyond 100 matches and intersects multiple files', async () => {
    const requested: Array<[string, number]> = [];
    const ids = await loadFilePlanMatches(
      ['a.ts', 'b.ts'],
      async (path, offset) => {
        requested.push([path, offset]);
        if (path === 'b.ts') return page(['plan-125'], 1);
        const all = Array.from({ length: 126 }, (_, i) => `plan-${i}`);
        return page(all.slice(offset, offset + 100), all.length, offset);
      },
      new AbortController().signal,
    );
    expect([...ids]).toEqual(['plan-125']);
    expect(requested).toEqual([
      ['a.ts', 0],
      ['a.ts', 100],
      ['b.ts', 0],
    ]);
  });
  test('cancels superseded requests before loading another page', async () => {
    const controller = new AbortController();
    let calls = 0;
    const result = await loadFilePlanMatches(
      ['a.ts'],
      async () => {
        calls++;
        controller.abort();
        return page(['stale'], 101);
      },
      controller.signal,
    ).catch((error: unknown) => error);
    expect(result instanceof DOMException).toBe(true);
    expect(calls).toBe(1);
  });
  test('empty intermediate pages report a failure instead of silently discarding matches', async () => {
    const result = await loadFilePlanMatches(
      ['a.ts'],
      async () => page([], 10),
      new AbortController().signal,
    ).catch((error: unknown) => error);
    expect(result instanceof Error).toBe(true);
  });
});
