import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmptyStateView } from './EmptyStateView.tsx';

const loadUsage = async () => null;

describe('EmptyStateView usage summary', () => {
  test('shows the unavailable reason without a loading ledger', () => {
    const reason = 'Cloud usage statistics are unavailable with Obfuscation.';
    const html = renderToStaticMarkup(
      <EmptyStateView usageLoader={loadUsage} usageUnavailableReason={reason} />,
    );
    expect(html).toContain(reason);
    expect(html).not.toContain('Aggregating usage stats…');
    expect(html).not.toContain('empty-state-usage--loading');
  });
  test('shows a loading ledger while usage stats are being aggregated', () => {
    const html = renderToStaticMarkup(<EmptyStateView usageLoader={loadUsage} />);

    expect(html).toContain('Aggregating usage stats…');
    expect(html).toContain('empty-state-usage--loading');
    expect(html).toContain('aria-busy="true"');
  });

  test('hides the loading ledger after aggregation returns no usage', () => {
    const html = renderToStaticMarkup(
      <EmptyStateView usageSummary={null} usageLoader={loadUsage} />,
    );

    expect(html).not.toContain('Aggregating usage stats…');
    expect(html).not.toContain('empty-state-usage--loading');
  });
});
