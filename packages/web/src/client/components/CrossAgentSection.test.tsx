import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { CrossAgentSection } from './CrossAgentSection.tsx';
import type { Plan } from '../lib/api.ts';
const plan: Plan = {
  id: 'a',
  agent: 'codex',
  title: '<script>bad()</script>',
  content: 'Actual plan',
  filePath: '/tmp/a.md',
  format: 'md',
  createdAt: '2026',
  updatedAt: '2026',
  metadata: {},
};
test('initial handoff UI exposes manual export and safe unavailable-workspace state without commands', () => {
  const html = renderToStaticMarkup(<CrossAgentSection plan={plan} allPlans={[]} />);
  expect(html).toContain('<summary>Compare across agents and hand off</summary>');
  expect(html).toContain('A workspace is required');
  expect(html).toContain('Download handoff Markdown');
  expect(html).toContain('POSIX shell');
  expect(html).not.toContain('&&');
  expect(html).not.toContain('<script>');
});
test('search waits for the plan list to finish loading', () => {
  const html = renderToStaticMarkup(
    <CrossAgentSection
      plan={{ ...plan, workspace: '/repo' }}
      allPlans={[]}
      options={{ plansComplete: false }}
    />,
  );
  expect(html).toContain('Loading plans…');
  expect(html).toMatch(/<button type="button" disabled="">Loading plans…<\/button>/);
});
