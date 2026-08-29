import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const eeAppSource = readFileSync(join(import.meta.dir, 'App.tsx'), 'utf8');
const ossAppSource = readFileSync(join(import.meta.dir, '../../app/src/client/App.tsx'), 'utf8');

test('activity brief is integrated into the EE client only', () => {
  expect(eeAppSource).toContain('<MorningBrief');
  expect(eeAppSource).toContain('agendex-brief-trigger');
  expect(ossAppSource).not.toContain('MorningBrief');
  expect(ossAppSource).not.toContain('agendex_brief_last_read_at');
});

test('cloud usage is loaded from Convex instead of the OSS API route', () => {
  expect(eeAppSource).toContain('api.cli.getUsage');
  expect(eeAppSource).toContain("usageSummary={mode === 'cloud' ? cloudUsage : undefined}");
  expect(eeAppSource).toContain("usageLoader={mode === 'cloud' ? loadCloudUsage : undefined}");
});

test('plan sources action keeps the complete folder icon path', () => {
  const actionStart = eeAppSource.indexOf('aria-label="Manage plan sources"');
  const actionSource = eeAppSource.slice(actionStart, actionStart + 1_200);

  expect(actionStart).toBeGreaterThan(-1);
  expect(actionSource).toContain(
    'd="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"',
  );
});
