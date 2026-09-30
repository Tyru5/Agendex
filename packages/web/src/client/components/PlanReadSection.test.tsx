import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlanReadDiff } from './PlanReadDiff.tsx';
import { PlanReadSection, shouldRequestPlanRead } from './PlanReadSection.tsx';
import { readRevisionKey, readVisitKey, readSummary } from '../lib/plan-read-session.ts';
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

test('live title, content, and metadata refreshes keep the same visit boundary', () => {
  const key = readVisitKey('local', plan);
  expect(
    readVisitKey('local', { ...plan, title: 'New', content: 'Updated', updatedAt: '2026-09-30' }),
  ).toBe(key);
  expect(readVisitKey('cloud', plan)).not.toBe(key);
  expect(readVisitKey('local', { ...plan, id: 'other' })).not.toBe(key);
});

test('unified read diff describes removed and added rows', () => {
  const html = renderToStaticMarkup(
    <PlanReadDiff
      baseline={{ title: 'Plan', content: 'Old step', updatedAt: '2026-09-29' }}
      current={{ title: 'Plan', content: 'New step', updatedAt: '2026-09-30' }}
    />,
  );
  expect(html).toContain('Removed lines use −; added lines use +.');
  expect(html).not.toContain('Earlier read on the left');
});

test('a revision refreshed before rejection retries after the stale opening rejects', () => {
  const key = readVisitKey('local', plan);
  const staleRevision = readRevisionKey('local', plan);
  const refreshedRevision = readRevisionKey('local', { ...plan, content: 'Updated' });

  expect(shouldRequestPlanRead({ key }, undefined, key, refreshedRevision)).toBe(false);
  expect(
    shouldRequestPlanRead(undefined, { key, revisionKey: staleRevision }, key, refreshedRevision),
  ).toBe(true);
});

test('a rejected revision waits for a refresh and retries only the newer revision', () => {
  const key = readVisitKey('local', plan);
  const staleRevision = readRevisionKey('local', plan);
  const failed = { key, revisionKey: staleRevision };

  expect(shouldRequestPlanRead(undefined, failed, key, staleRevision)).toBe(false);
  expect(
    shouldRequestPlanRead(
      undefined,
      failed,
      key,
      readRevisionKey('local', { ...plan, updatedAt: '2026-09-30' }),
    ),
  ).toBe(true);
});

test('a successful opening stays fixed across live revision refreshes', () => {
  const key = readVisitKey('local', plan);
  const refreshedRevision = readRevisionKey('local', { ...plan, content: 'Updated' });
  expect(shouldRequestPlanRead({ key }, undefined, key, refreshedRevision)).toBe(false);
});
