import { expect, test } from 'bun:test';
import { normalizePlanSourcePath, planMatchesSource } from '../../convex/planSourcePath.ts';

test('Given Windows and POSIX paths When normalizing Then separators and trailing slashes converge', () => {
  expect(normalizePlanSourcePath('C:\\Users\\Tyrus\\iris\\auto-sessions')).toBe(
    'C:/Users/Tyrus/iris/auto-sessions',
  );
  expect(normalizePlanSourcePath('C:\\Users\\Tyrus\\iris\\auto-sessions\\')).toBe(
    'C:/Users/Tyrus/iris/auto-sessions',
  );
  expect(normalizePlanSourcePath('/tmp/alpha///')).toBe('/tmp/alpha');
  expect(normalizePlanSourcePath('')).toBe('');
});

test('Given plan metadata When matching a source Then only custom-dir plans of that dir match', () => {
  const target = normalizePlanSourcePath('C:/Users/Tyrus/iris/auto-sessions');

  expect(
    planMatchesSource(
      { source: 'custom-dir', customDir: 'C:\\Users\\Tyrus\\iris\\auto-sessions' },
      target,
    ),
  ).toBe(true);
  expect(
    planMatchesSource(
      { source: 'custom-dir', customDir: 'C:\\Users\\Tyrus\\iris\\auto-sessions\\' },
      target,
    ),
  ).toBe(true);
  expect(
    planMatchesSource({ source: 'custom-dir', customDir: 'C:\\Users\\Tyrus\\other' }, target),
  ).toBe(false);
  expect(
    planMatchesSource(
      { source: 'adapter', customDir: 'C:/Users/Tyrus/iris/auto-sessions' },
      target,
    ),
  ).toBe(false);
  expect(planMatchesSource({ source: 'custom-dir' }, target)).toBe(false);
  expect(planMatchesSource(null, target)).toBe(false);
  expect(planMatchesSource(undefined, target)).toBe(false);
  expect(planMatchesSource('custom-dir', target)).toBe(false);
});
