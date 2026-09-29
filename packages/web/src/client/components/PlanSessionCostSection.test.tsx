import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { sessionCostFromSnapshots, unavailableSessionCost } from '@agendex/shared/session-cost';
import { emptyTokenTotals } from '../../../../shared/src/usage/types.ts';
import { PlanSessionCostSection } from './PlanSessionCostSection.tsx';
const identity = { agent: 'codex-cli' as const, sessionId: '<unsafe-session>' };
const cost = sessionCostFromSnapshots(
  identity,
  [
    {
      days: 90,
      generatedAt: new Date().toISOString(),
      records: 1,
      events: [
        {
          key: 'a',
          ...identity,
          model: 'model',
          timestampMs: Date.now(),
          bucketStart: '2026-09-29',
          totals: { ...emptyTokenTotals(), outputTokens: 50 },
          costUsd: 0.25,
          cacheSavingsUsd: 0,
          unpriced: false,
        },
      ],
    },
  ],
  2,
);
test('labels USD estimate as whole-session usage and warns about shared plans', () => {
  const html = renderToStaticMarkup(<PlanSessionCostSection sessionCost={cost} />);
  expect(html).toContain('Session cost');
  expect(html).toContain('Estimated $0.25');
  expect(html).toContain('2 indexed plans share this session');
  expect(html).toContain('not individual plan spend');
  expect(html).toContain('last 90 days');
  expect(html).toContain('USD API-equivalent estimate');
  expect(html).toContain('&lt;unsafe-session&gt;');
  expect(html).not.toContain('<unsafe-session>');
});
test('unknown, partial, unavailable, and loading states never assert free spend', () => {
  expect(
    renderToStaticMarkup(
      <PlanSessionCostSection
        sessionCost={{ ...cost, costUsd: null, pricing: 'unpriced', unpricedRecords: 1 }}
      />,
    ),
  ).toContain('No dollar estimate is available');
  expect(
    renderToStaticMarkup(
      <PlanSessionCostSection sessionCost={{ ...cost, pricing: 'partial', unpricedRecords: 1 }} />,
    ),
  ).toContain('At least $0.25');
  expect(
    renderToStaticMarkup(
      <PlanSessionCostSection sessionCost={unavailableSessionCost('incomplete-snapshot')} />,
    ),
  ).toContain('Synced usage events are incomplete');
  expect(renderToStaticMarkup(<PlanSessionCostSection sessionCost={null} loading />)).toContain(
    'Checking session usage',
  );
});
