import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlanCheckSection } from './PlanCheckSection.tsx';

test('unvalidated plan checks never claim a clean file check', () => {
  const html = renderToStaticMarkup(
    <PlanCheckSection
      paths={null}
      plan={{
        content: 'Update `src/a.ts`. Run `bun test`. Done when the handler responds.',
      }}
    />,
  );
  expect(html).toContain('<details');
  expect(html).toContain('<summary>');
  expect(html).toContain('File checks incomplete');
  expect(html).toContain('File checks unavailable');
  expect(html).not.toContain('No issues detected');
});
