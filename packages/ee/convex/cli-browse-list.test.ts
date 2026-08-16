import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'cli.ts'), 'utf8');
const httpSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'http.ts'), 'utf8');

test('browse list endpoint pages owner plans and stays authenticated', () => {
  expect(httpSource).toContain("path: '/api/cli/plans'");
  expect(httpSource).toContain('listPlans');
  expect(cliSource).toContain('listPlansForBrowse');
  expect(cliSource).toContain('PLAN_BROWSE_PAGE_SIZE');
  expect(cliSource).toContain('50');
  expect(cliSource).toContain('authenticateRequest');
  expect(cliSource).toContain('search_title');
  expect(cliSource).toContain("withIndex('by_owner'");
  expect(cliSource).toContain('selectPlanDownloadMatches');
  expect(cliSource).toContain("status: 'ok'");
});
