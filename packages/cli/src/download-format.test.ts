import { expect, test } from 'bun:test';
import {
  createPlanDownloadFilename,
  createPlanHtmlDocument,
  inferPlanDownloadFormat,
  parsePlanDownloadFormat,
  renderPlanDownload,
} from './download-format.ts';

const plan = {
  agent: 'claude-code',
  content: '# Add auth\n\nUse <tokens> & "sessions".\n',
  filePath: '/tmp/add-auth.md',
  title: 'Add auth',
  updatedAt: '2026-08-02T00:00:00.000Z',
};

test('parsePlanDownloadFormat accepts aliases', () => {
  expect(parsePlanDownloadFormat('markdown')).toBe('md');
  expect(parsePlanDownloadFormat('.HTML')).toBe('html');
  expect(parsePlanDownloadFormat('pdf')).toBe('pdf');
  expect(parsePlanDownloadFormat('docx')).toBe('invalid');
});

test('inferPlanDownloadFormat reads the file extension', () => {
  expect(inferPlanDownloadFormat('exports/plan.html')).toBe('html');
  expect(inferPlanDownloadFormat('plan.MD')).toBe('md');
  expect(inferPlanDownloadFormat('plan.pdf')).toBe('pdf');
  expect(inferPlanDownloadFormat('exports')).toBeUndefined();
});

test('createPlanDownloadFilename sanitizes the title', () => {
  expect(createPlanDownloadFilename(plan, 'md')).toBe('Add auth.md');
  expect(createPlanDownloadFilename({ ...plan, title: 'A/B: plan*' }, 'html')).toBe(
    'A-B- plan.html',
  );
  expect(createPlanDownloadFilename({ ...plan, title: 'Add \u202eauth' }, 'md')).toBe(
    'Add auth.md',
  );
});

test('createPlanDownloadFilename keeps multibyte titles within 255 filename bytes', () => {
  const title = '测'.repeat(90);
  const filename = createPlanDownloadFilename({ ...plan, title }, 'md');
  expect(new TextEncoder().encode(filename).length).toBeLessThanOrEqual(255);
  expect(filename.endsWith('.md')).toBe(true);
  expect(filename.startsWith('测')).toBe(true);
});

test('createPlanDownloadFilename rewrites Windows reserved device stems', () => {
  const reserved = ['CON', 'PRN', 'AUX', 'NUL', 'CONIN$', 'CONOUT$', 'COM1', 'LPT9', 'nul.md'];
  for (const title of reserved) {
    const filename = createPlanDownloadFilename({ ...plan, title }, 'md');
    expect(filename.toLowerCase()).not.toMatch(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/);
    expect(filename.endsWith('.md')).toBe(true);
  }
  expect(createPlanDownloadFilename({ ...plan, title: 'CON' }, 'md')).toBe('agendex-plan-CON.md');
  expect(createPlanDownloadFilename({ ...plan, title: 'CONIN$' }, 'md')).toBe(
    'agendex-plan-CONIN$.md',
  );
  expect(createPlanDownloadFilename({ ...plan, title: 'NUL' }, 'html')).toBe(
    'agendex-plan-NUL.html',
  );
});

test('html rendering escapes content and includes metadata', () => {
  const html = createPlanHtmlDocument(plan);
  expect(html).toContain('Add auth');
  expect(html).toContain('claude-code');
  expect(html).toContain('Use &lt;tokens&gt; &amp; &quot;sessions&quot;.');
  expect(renderPlanDownload(plan, 'md')).toBe('# Add auth\n\nUse <tokens> & "sessions".\n');
});
