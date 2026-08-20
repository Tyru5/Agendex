import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'cli.ts'), 'utf8');

test('download lookup resolves the workspace owner and pages fallback across queries', () => {
  expect(source).toContain('resolvePublishedPlansOwnerId');
  expect(source).toContain("mode: 'fallback'");
  expect(source).toContain('userId');
  expect(source).toContain('dedupePlanDownloadCandidates');
  expect(source).toContain('PLAN_DOWNLOAD_FALLBACK_PAGE_SIZE');
  expect(source).toContain('250');
  expect(source).toContain('did not finish scanning all plans');
  expect(source).toContain('by_owner_and_agent');
  const truncatedAt = source.indexOf('if (truncated)');
  const titleSelectAt = source.lastIndexOf('selectPlanDownloadMatches(pool, query, agent)');
  expect(truncatedAt).toBeGreaterThan(0);
  expect(titleSelectAt).toBeGreaterThan(truncatedAt);
  expect(source).not.toMatch(/scanPlanDownloadFallback\(/);
  const loopAt = source.indexOf('while (pages < maxPages)');
  const selectAt = source.lastIndexOf('selectPlanDownloadMatches(pool, query, agent)');
  expect(loopAt).toBeGreaterThan(0);
  expect(selectAt).toBeGreaterThan(loopAt);
});
