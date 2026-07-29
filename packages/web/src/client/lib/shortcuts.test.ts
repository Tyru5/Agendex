import { describe, expect, test } from 'bun:test';
import { getAppShortcuts, shortcutDisplayKeys } from './shortcuts.ts';

describe('getAppShortcuts', () => {
  test('returns common shortcuts by default', () => {
    const ids = getAppShortcuts().map((s) => s.id);
    expect(ids).toEqual(['search', 'sidebar', 'outline', 'escape']);
  });

  test('includes ee shortcuts when requested', () => {
    const ids = getAppShortcuts({ ee: true }).map((s) => s.id);
    expect(ids).toContain('palette');
    expect(ids).toContain('chart');
    expect(ids).toContain('comment');
    expect(ids).toContain('search');
  });
});

describe('shortcutDisplayKeys', () => {
  test('returns literal keys for search and escape', () => {
    const shortcuts = getAppShortcuts();
    const search = shortcuts.find((s) => s.id === 'search');
    const escape = shortcuts.find((s) => s.id === 'escape');
    expect(search && shortcutDisplayKeys(search)).toEqual(['/']);
    expect(escape && shortcutDisplayKeys(escape)).toEqual(['Esc']);
  });

  test('formats mod hotkeys into key tokens', () => {
    const sidebar = getAppShortcuts().find((s) => s.id === 'sidebar');
    expect(sidebar).toBeDefined();
    const keys = shortcutDisplayKeys(sidebar!);
    expect(keys.length).toBeGreaterThanOrEqual(2);
    expect(keys.at(-1)).toBe('B');
  });
});
