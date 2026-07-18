import { expect, test } from 'bun:test';
import { planContentChanged } from './planVersioning';

test('planContentChanged is false when title and content match', () => {
  expect(
    planContentChanged(
      { title: 'Plan', content: '# Steps\n- do thing\n' },
      { title: 'Plan', content: '# Steps\n- do thing\n' },
    ),
  ).toBe(false);
});

test('planContentChanged is true when title changes', () => {
  expect(
    planContentChanged({ title: 'Plan', content: 'body' }, { title: 'Plan v2', content: 'body' }),
  ).toBe(true);
});

test('planContentChanged is true when content changes', () => {
  expect(
    planContentChanged({ title: 'Plan', content: 'old' }, { title: 'Plan', content: 'new' }),
  ).toBe(true);
});
