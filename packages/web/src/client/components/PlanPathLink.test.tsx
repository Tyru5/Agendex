import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlanPathContext, type PlanPathContextValue } from './PlanPathContext.tsx';
import { PlanPathCode } from './PlanPathLink.tsx';

function renderPlanPath(code: string, results: PlanPathContextValue['results']): string {
  const context: PlanPathContextValue = {
    planId: 'plan-1',
    status: 'ready',
    results,
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
});
