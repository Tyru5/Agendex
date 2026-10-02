import { FilePlanCountsContext } from './FilePlanLookupContext.tsx';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlanPathContext, type PlanPathContextValue } from './PlanPathContext.tsx';
import { PlanPathCode } from './PlanPathLink.tsx';

function renderPlanPath(
  code: string,
  results: PlanPathContextValue['results'],
  remoteTargets: PlanPathContextValue['remoteTargets'] = {},
): string {
  const context: PlanPathContextValue = {
    planId: 'plan-1',
    status: 'ready',
    results,
    remoteTargets,
    apps: [{ id: 'cursor', label: 'Cursor', kind: 'editor' }],
    preferredAppId: 'cursor',
    openPath: async () => ({ ok: true }),
  };

  return renderToStaticMarkup(
    <PlanPathContext.Provider value={context}>
      <PlanPathCode>{code}</PlanPathCode>
    </PlanPathContext.Provider>,
  );
}

describe('PlanPathCode', () => {
  // User story: a validated path in plan Markdown is visibly actionable.
  test('renders validated path mentions as source buttons', () => {
    const html = renderPlanPath('src/main.ts', {
      'src/main.ts': {
        status: 'found',
        resolved: '/repo/src/main.ts',
        relative: 'src/main.ts',
      },
    });

    expect(html).toContain('data-agendex-path="src/main.ts"');
    expect(html).toContain('class="plan-path-open"');
    expect(html).toContain('<code>src/main.ts</code>');
  });

  // User story: a missing source remains readable code without a misleading action.
  test('renders missing paths as plain inline code', () => {
    const html = renderPlanPath('src/missing.ts', {
      'src/missing.ts': { status: 'missing' },
    });

    expect(html).toContain('<code>src/missing.ts</code>');
    expect(html).not.toContain('data-agendex-path');
    expect(html).not.toContain('plan-path-open');
  });

  // User story: validation outages leave path text readable and non-interactive.
  test('renders paths as plain code when validation has no result', () => {
    const html = renderPlanPath('src/unavailable.ts', {});

    expect(html).toContain('<code>src/unavailable.ts</code>');
    expect(html).not.toContain('data-agendex-path');
  });

  test('renders a git-forge target when no local result is available', () => {
    const html = renderPlanPath(
      'src/cloud.ts',
      {},
      {
        ['src/cloud.ts\0\0']: {
          url: 'https://github.com/acme/repo/blob/main/src/cloud.ts',
          label: 'Open on GitHub',
        },
      },
    );

    expect(html).toContain('data-agendex-path="src/cloud.ts"');
    expect(html).toContain('data-path-status="remote"');
    expect(html).toContain('title="Open on GitHub"');
  });
});

describe('file provenance path action', () => {
  test('new or deleted source paths still offer related-plan lookup', () => {
    const html = renderToStaticMarkup(
      <FilePlanCountsContext.Provider
        value={{
          counts: { 'src/new.ts': { path: 'src/new.ts', count: 3, exact: true } },
          navigate: () => {},
        }}
      >
        <PlanPathCode>src/new.ts</PlanPathCode>
      </FilePlanCountsContext.Provider>,
    );
    expect(html).toContain('title="Find plans for this file"');
    expect(html).toContain('aria-label="3 related plans"');
    expect(html).toContain('<code>src/new.ts</code>');
  });
  test('capped cloud counts identify their lower bound', () => {
    const html = renderToStaticMarkup(
      <FilePlanCountsContext.Provider
        value={{
          counts: { 'src/new.ts': { path: 'src/new.ts', count: 100, exact: false } },
          navigate: () => {},
        }}
      >
        <PlanPathCode>src/new.ts</PlanPathCode>
      </FilePlanCountsContext.Provider>,
    );
    expect(html).toContain('100+ related plans');
  });
  test('public read-only rendering without an authorized lookup has no private count', () => {
    const html = renderToStaticMarkup(<PlanPathCode>src/new.ts</PlanPathCode>);
    expect(html).toBe('<code>src/new.ts</code>');
  });
  test('loading or failed counts retain an actionable file lookup without false zero', () => {
    const html = renderToStaticMarkup(
      <FilePlanCountsContext.Provider value={{ counts: {}, navigate: () => {} }}>
        <PlanPathCode>src/new.ts</PlanPathCode>
      </FilePlanCountsContext.Provider>,
    );
    expect(html).toContain('Find plans for this file');
    expect(html).not.toContain('0 related plans');
  });
});
