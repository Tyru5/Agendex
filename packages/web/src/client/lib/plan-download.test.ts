import { expect, test } from 'bun:test';
import type { Plan } from './api.ts';
import {
  createPlanDownloadFilename,
  createPlanHtmlDocument,
  createPlanMarkdownContent,
  type PlanDownloadFormat,
} from './plan-download.ts';

function makePlan(overrides: Partial<Plan>): Plan {
  return {
    id: 'plan-1',
    agent: 'codex-cli',
    title: 'Implementation plan',
    content: '# Plan\n\nDo the work.',
    filePath: '/workspace/Implementation plan.md',
    format: 'md',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-07-06T18:30:00.000Z',
    metadata: {},
    ...overrides,
  };
}

test('createPlanDownloadFilename replaces invalid filename characters and selects the extension', () => {
  const plan = makePlan({ title: 'Phase 1: read/write*plans?' });

  expect(createPlanDownloadFilename(plan, 'html')).toBe('Phase 1- read-write-plans.html');
});

test('createPlanDownloadFilename falls back to the file basename before the default name', () => {
  const plan = makePlan({
    title: '   ',
    filePath: '/tmp/agent plans/Source Plan.md',
  });

  expect(createPlanDownloadFilename(plan, 'md')).toBe('Source Plan.md');
});

test('createPlanDownloadFilename uses agendex-plan when title and path are empty', () => {
  const plan = makePlan({ title: '', filePath: '' });

  expect(createPlanDownloadFilename(plan, 'pdf')).toBe('agendex-plan.pdf');
});

test('createPlanDownloadFilename limits the sanitized stem to ninety characters', () => {
  const plan = makePlan({ title: 'a'.repeat(120) });

  expect(createPlanDownloadFilename(plan, 'md')).toBe(`${'a'.repeat(90)}.md`);
});

test('createPlanDownloadFilename supports every plan download format extension', () => {
  const plan = makePlan({ title: 'Format check' });
  const cases: readonly { readonly format: PlanDownloadFormat; readonly filename: string }[] = [
    { format: 'md', filename: 'Format check.md' },
    { format: 'html', filename: 'Format check.html' },
    { format: 'pdf', filename: 'Format check.pdf' },
  ];

  for (const { format, filename } of cases) {
    expect(createPlanDownloadFilename(plan, format)).toBe(filename);
  }
});

test('createPlanMarkdownContent normalizes stored plan content to LF', () => {
  const plan = makePlan({ content: 'line one\r\nline two\rline three\n' });

  expect(createPlanMarkdownContent(plan)).toBe('line one\nline two\nline three\n');
});

test('createPlanHtmlDocument escapes plan title, path, and body content', () => {
  const plan = makePlan({
    title: '<Draft & Review>',
    filePath: '/tmp/<unsafe>.md',
    content: '# <script>alert("x")</script>\nUse A & B.',
  });
  const html = createPlanHtmlDocument(plan);

  expect(html).toContain('&lt;Draft &amp; Review&gt;');
  expect(html).toContain('/tmp/&lt;unsafe&gt;.md');
  expect(html).toContain('# &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  expect(html).toContain('Use A &amp; B.');
  expect(html).not.toContain('<script>alert("x")</script>');
});

test('createPlanHtmlDocument includes readable export metadata', () => {
  const plan = makePlan({
    agent: 'claude-code',
    title: 'Metadata plan',
    filePath: '/repo/plans/metadata.md',
    updatedAt: '2026-07-06T18:30:00.000Z',
  });
  const html = createPlanHtmlDocument(plan);

  expect(html).toContain('<dt>Agent</dt>');
  expect(html).toContain('<dd>claude-code</dd>');
  expect(html).toContain('<dt>Updated</dt>');
  expect(html).toContain('2026-07-06T18:30:00.000Z');
  expect(html).toContain('<dt>Path</dt>');
  expect(html).toContain('/repo/plans/metadata.md');
});
