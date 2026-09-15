import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const convexDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(convexDir, 'cli.ts'), 'utf8');
const schema = readFileSync(join(convexDir, 'schema.ts'), 'utf8');
const plans = readFileSync(join(convexDir, 'plans.ts'), 'utf8');
const versions = readFileSync(join(convexDir, 'planVersions.ts'), 'utf8');
const crons = readFileSync(join(convexDir, 'crons.ts'), 'utf8');

test('download lookup uses bounded indexed reads instead of walking the owner corpus', () => {
  expect(source).toContain('PLAN_DOWNLOAD_TITLE_PAGE_SIZE = 8');
  expect(source).toContain('PLAN_DOWNLOAD_LOCAL_ID_READ_LIMIT');
  expect(source).toContain("withIndex('by_owner_and_titleNormalized_and_agentNormalized'");
  expect(source).toContain('numItems: PLAN_DOWNLOAD_TITLE_PAGE_SIZE');
  expect(source).toContain('.take(PLAN_DOWNLOAD_SEARCH_MAX_RESULTS)');
  expect(source).not.toContain("mode: 'fallback'");
  expect(source).not.toContain('while (pages < maxPages)');
  expect(source).not.toContain('did not finish scanning all plans');
});

test('exact Convex ids short-circuit before title pagination', () => {
  const directIdLookup = source.indexOf("ctx.db.normalizeId('plans', query)");
  const titleLookup = source.indexOf('const indexedTitleQuery');
  expect(directIdLookup).toBeGreaterThan(0);
  expect(titleLookup).toBeGreaterThan(directIdLookup);
  expect(source.slice(directIdLookup, titleLookup)).toContain('ctx.db.get(planId)');
  expect(source.slice(directIdLookup, titleLookup)).toContain("status: 'found' as const");
});

test('normalized title and agent keys are indexed and maintained by every title write path', () => {
  expect(schema).toContain('titleNormalized: v.optional(v.string())');
  expect(schema).toContain('agentNormalized: v.optional(v.string())');
  expect(schema).toContain("'by_owner_and_titleNormalized_and_agentNormalized'");
  expect(source).toContain('backfillPlanDownloadLookupKeys');
  expect(crons).toContain('internal.cli.backfillPlanDownloadLookupKeys');
  expect(source).toContain("withIndex('by_titleNormalized'");
  expect(source).toContain('titleNormalized: normalizePlanLookupText(args.title)');
  expect(plans.match(/titleNormalized: normalizePlanLookupText/g)).toHaveLength(4);
  expect(versions).toContain('titleNormalized: normalizePlanLookupText(snapshot.title)');
});

test('ambiguous exact-title responses expose bounded pagination', () => {
  expect(source).toContain("status: 'ambiguous' as const");
  expect(source).toContain('nextCursor: titleSelection.hasMore ? titlePage.continueCursor : null');
  expect(source).toContain('hasMore: titleSelection.hasMore');
  expect(source).toContain('pageSize: PLAN_DOWNLOAD_TITLE_PAGE_SIZE');
});

test('continuation pages remain ambiguity pages instead of auto-selecting a later row', () => {
  const cursorBranch = source.indexOf('if (args.titleCursor)');
  const singleSelection = source.indexOf("if (titleSelection.kind === 'one')");
  expect(cursorBranch).toBeGreaterThan(0);
  expect(singleSelection).toBeGreaterThan(cursorBranch);
  expect(source.slice(cursorBranch, singleSelection)).toContain("status: 'ambiguous' as const");
});
