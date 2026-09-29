import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlanReadSection, readRevisionKey, readSummary } from './PlanReadSection.tsx';
import type { Plan } from '../lib/api.ts';
const plan = { id: 'p', title: 'Plan', content: 'Steps' } as Plan;
test('public viewer without a private read source has no recording UI', () => {
  expect(renderToStaticMarkup(<PlanReadSection plan={plan} />)).toBe('');
});
test('first read and lost snapshots never claim a diff exists', () => {
  expect(readSummary({ baseline: null, reason: 'first-read' }, plan)).toContain(
    'No earlier read snapshot',
  );
  expect(readSummary({ baseline: null, reason: 'unavailable' }, plan)).toContain(
    'no longer available',
  );
});
test('metadata-only updates are unchanged while title and body updates are changes', () => {
  const baseline = { title: 'Plan', content: 'Steps', updatedAt: '2020-01-01' };
  expect(readSummary({ baseline, reason: 'available' }, plan)).toContain('unchanged');
  expect(readSummary({ baseline, reason: 'available' }, { ...plan, title: 'New title' })).toContain(
    'Changes available',
  );
  expect(
    readSummary({ baseline, reason: 'available' }, { ...plan, content: 'New steps' }),
  ).toContain('Changes available');
});

test('workspace reassignment and account/mode changes invalidate pending read identities', () => {
  const initial = readRevisionKey('local', { ...plan, workspace: '/workspace/one' });
  expect(readRevisionKey('local', { ...plan, workspace: '/workspace/two' })).not.toBe(initial);
  expect(readRevisionKey('cloud', { ...plan, workspace: '/workspace/one' })).not.toBe(initial);
  expect(
    readRevisionKey('local', { ...plan, workspace: '/workspace/one', ownerId: 'other-owner' }),
  ).not.toBe(initial);
});
