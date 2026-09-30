import { expect, test } from 'bun:test';
import type { Plan } from '@agendex/web';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  PlanReadContext,
  type PlanReadSource,
} from '../../../web/src/client/lib/plan-read-context.tsx';
import { PlanReadSection } from '../../../web/src/client/components/PlanReadSection.tsx';
import { readRevisionKey, requestPlanRead } from '../../../web/src/client/lib/plan-read-session.ts';
import { ownedPlanReadSource, publishedCloudPlan } from '../lib/owned-plan-read-source.ts';
const plan = {
  id: 'owned-plan',
  ownerId: 'owner',
  title: 'Plan',
  content: 'Actual loaded steps',
  contentLoaded: true,
} as Plan;

test('members and unresolved accounts neither render the private section nor send automatic reads', () => {
  let requests = 0;
  const open: PlanReadSource['open'] = async () => {
    requests++;
    return { baseline: null, reason: 'first-read' };
  };
  for (const userId of ['member', undefined]) {
    const source = ownedPlanReadSource(userId, open, async () => {});
    expect(requestPlanRead(readRevisionKey(source.scope, plan), source, plan)).toBeNull();
    expect(
      renderToStaticMarkup(
        <PlanReadContext.Provider value={source}>
          <PlanReadSection plan={plan} />
        </PlanReadContext.Provider>,
      ),
    ).toBe('');
  }
  expect(requests).toBe(0);
});

test('newly created and uploaded cloud plans carry owner identity into their first opening', async () => {
  let requests = 0;
  const source = ownedPlanReadSource(
    'owner',
    async () => {
      requests++;
      return { baseline: null, reason: 'first-read' };
    },
    async () => {},
  );
  const publishedAt = 1_700_000_000_000;
  const initialPlans = [
    publishedCloudPlan({
      _id: 'created-plan',
      ownerId: 'owner',
      agent: 'omp',
      title: 'Created',
      content: 'Created steps',
      format: 'md',
      createdAt: publishedAt,
      updatedAt: publishedAt,
    }),
    publishedCloudPlan({
      _id: 'uploaded-plan',
      ownerId: 'owner',
      agent: 'omp',
      title: 'Uploaded',
      content: 'Uploaded steps',
      format: 'md',
      createdAt: publishedAt,
      updatedAt: publishedAt,
    }),
  ];

  for (const initialPlan of initialPlans) {
    expect(initialPlan.ownerId).toBe('owner');
    expect(initialPlan.updatedAt).toBe(new Date(publishedAt).toISOString());
    await requestPlanRead(readRevisionKey(source.scope, initialPlan), source, initialPlan);
  }

  expect(requests).toBe(2);
});

test('account switching cannot inherit a pending owner read; loaded owner and local plans stay eligible', async () => {
  let requests = 0;
  let resolve: (() => void) | undefined;
  const open: PlanReadSource['open'] = () => {
    requests++;
    return new Promise((done) => {
      resolve = () => done({ baseline: null, reason: 'first-read' });
    });
  };
  const ownerSource = ownedPlanReadSource('owner', open, async () => {});
  const key = readRevisionKey(ownerSource.scope, plan);
  const pending = requestPlanRead(key, ownerSource, plan);
  expect(requests).toBe(1);
  const memberSource = ownedPlanReadSource('member', open, async () => {});
  expect(readRevisionKey(memberSource.scope, plan)).not.toBe(key);
  // Eligibility must be checked even before looking up a duplicate pending request.
  expect(requestPlanRead(key, memberSource, plan)).toBeNull();
  expect(
    requestPlanRead(
      key,
      ownedPlanReadSource(undefined, open, async () => {}),
      plan,
    ),
  ).toBeNull();
  expect(requestPlanRead('unloaded', ownerSource, { ...plan, contentLoaded: false })).toBeNull();
  expect(requests).toBe(1);
  if (!resolve) throw new Error('Expected pending owner request');
  resolve();
  await pending;
  const local: PlanReadSource = {
    scope: 'local',
    open: async () => {
      requests++;
      return { baseline: null, reason: 'first-read' };
    },
    clear: async () => {},
  };
  await requestPlanRead('local-plan', local, { ...plan, ownerId: undefined });
  expect(requests).toBe(2);
});
