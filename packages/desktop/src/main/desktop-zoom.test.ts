import { describe, expect, test } from 'bun:test';
import {
  getNextPageZoomLevel,
  installDesktopPageZoomShortcuts,
  type PageZoomInput,
  resolvePageZoomShortcut,
} from './desktop-zoom.ts';

function input(overrides: Partial<PageZoomInput> = {}): PageZoomInput {
  return {
    type: 'keyDown',
    key: '',
    code: '',
    control: true,
    meta: false,
    alt: false,
    ...overrides,
  };
}

describe('desktop page zoom shortcuts', () => {
  test('recognizes shortcuts by their semantic key', () => {
    expect(resolvePageZoomShortcut(input({ key: '+', code: 'Equal' }), false)).toBe('in');
    expect(resolvePageZoomShortcut(input({ key: '=', code: 'Equal' }), false)).toBe('in');
    expect(resolvePageZoomShortcut(input({ key: '+', code: 'NumpadAdd' }), false)).toBe('in');
    expect(resolvePageZoomShortcut(input({ key: '-', code: 'NumpadSubtract' }), false)).toBe('out');
    expect(resolvePageZoomShortcut(input({ key: '0', code: 'Numpad0' }), false)).toBe('reset');
  });

  test('uses Command on macOS and Control on other platforms', () => {
    expect(resolvePageZoomShortcut(input({ key: '+' }), false)).toBe('in');
    expect(resolvePageZoomShortcut(input({ control: false, meta: true, key: '+' }), true)).toBe(
      'in',
    );
    expect(
      resolvePageZoomShortcut(input({ control: false, meta: true, key: '+' }), false),
    ).toBeNull();
    expect(resolvePageZoomShortcut(input({ key: '+' }), true)).toBeNull();
    expect(resolvePageZoomShortcut(input({ meta: true, key: '+' }), false)).toBeNull();
  });

  test('does not treat physical key codes as zoom shortcuts', () => {
    expect(resolvePageZoomShortcut(input({ key: 'Insert', code: 'Numpad0' }), false)).toBeNull();
    expect(resolvePageZoomShortcut(input({ key: ')', code: 'Digit0' }), false)).toBeNull();
    expect(resolvePageZoomShortcut(input({ key: 'ß', code: 'Minus' }), false)).toBeNull();
  });

  test('ignores unrelated input and modifier combinations', () => {
    expect(resolvePageZoomShortcut(input({ control: false, key: '+' }), false)).toBeNull();
    expect(resolvePageZoomShortcut(input({ alt: true, key: '+' }), false)).toBeNull();
    expect(resolvePageZoomShortcut(input({ type: 'keyUp', key: '+' }), false)).toBeNull();
    expect(resolvePageZoomShortcut(input({ key: 'R', code: 'KeyR' }), false)).toBeNull();
  });

  test('uses Electron menu-role zoom-level steps', () => {
    expect(getNextPageZoomLevel(0, 'in')).toBe(0.5);
    expect(getNextPageZoomLevel(0, 'out')).toBe(-0.5);
    expect(getNextPageZoomLevel(1.25, 'in')).toBe(1.75);
    expect(getNextPageZoomLevel(1.25, 'reset')).toBe(0);
  });

  test('applies a shortcut once and forwards the new factor to the renderer', () => {
    type ZoomListener = (event: { preventDefault(): void }, shortcutInput: PageZoomInput) => void;

    let zoomLevel = 0;
    let factor = 1;
    let prevented = 0;
    const messages: Array<[string, number]> = [];
    const webContents = {
      listener: null as ZoomListener | null,
      on: (_event: 'before-input-event', nextListener: ZoomListener) => {
        webContents.listener = nextListener;
      },
      getZoomLevel: () => zoomLevel,
      setZoomLevel: (nextLevel: number) => {
        zoomLevel = nextLevel;
        factor = 1.2 ** zoomLevel;
      },
      getZoomFactor: () => factor,
      send: (channel: string, nextFactor: number) => {
        messages.push([channel, nextFactor]);
      },
    };

    installDesktopPageZoomShortcuts(webContents);

    const listener = webContents.listener;
    expect(listener).not.toBeNull();
    if (!listener) throw new Error('zoom shortcut listener was not installed');
    listener({ preventDefault: () => (prevented += 1) }, input({ key: '+', code: 'Equal' }));
    expect(zoomLevel).toBe(0.5);
    expect(factor).toBeCloseTo(1.2 ** 0.5);
    expect(prevented).toBe(1);
    expect(messages).toEqual([['agendex:page-zoom', 1.2 ** 0.5]]);

    listener({ preventDefault: () => (prevented += 1) }, input({ key: 'R', code: 'KeyR' }));
    expect(zoomLevel).toBe(0.5);
    expect(prevented).toBe(1);
    expect(messages).toHaveLength(1);
  });
});
