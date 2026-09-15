import { describe, expect, test } from 'bun:test';
import {
  type ForceReloadInput,
  installDesktopForceReloadShortcut,
  isForceReloadShortcut,
} from './desktop-reload.ts';

function input(overrides: Partial<ForceReloadInput> = {}): ForceReloadInput {
  return {
    type: 'keyDown',
    key: 'R',
    control: true,
    meta: false,
    shift: true,
    alt: false,
    ...overrides,
  };
}

function platformAcceleratorInput(overrides: Partial<ForceReloadInput> = {}): ForceReloadInput {
  const isMac = process.platform === 'darwin';
  return input({
    control: !isMac,
    meta: isMac,
    ...overrides,
  });
}

describe('desktop force reload shortcut', () => {
  test('recognizes the platform force reload keybind', () => {
    expect(isForceReloadShortcut(input(), false)).toBe(true);
    expect(isForceReloadShortcut(input({ control: false, meta: true }), true)).toBe(true);
  });

  test('ignores ordinary reload and unrelated modifier combinations', () => {
    expect(isForceReloadShortcut(input({ shift: false }), false)).toBe(false);
    expect(isForceReloadShortcut(input({ alt: true }), false)).toBe(false);
    expect(isForceReloadShortcut(input({ meta: true }), false)).toBe(false);
    expect(isForceReloadShortcut(input({ type: 'keyUp' }), false)).toBe(false);
    expect(isForceReloadShortcut(input({ key: 'K' }), false)).toBe(false);
  });

  test('prevents accelerator dispatch and reloads without cache once', () => {
    type ReloadListener = (
      event: { preventDefault(): void },
      shortcutInput: ForceReloadInput,
    ) => void;

    let listener: ReloadListener | undefined;
    let prevented = 0;
    let reloaded = 0;
    const webContents = {
      on: (_event: 'before-input-event', nextListener: ReloadListener) => {
        listener = nextListener;
      },
      reloadIgnoringCache: () => {
        reloaded += 1;
      },
    };

    installDesktopForceReloadShortcut(webContents);
    expect(listener).toBeDefined();
    listener?.({ preventDefault: () => (prevented += 1) }, platformAcceleratorInput());
    expect(prevented).toBe(1);
    expect(reloaded).toBe(1);

    listener?.(
      { preventDefault: () => (prevented += 1) },
      platformAcceleratorInput({ shift: false }),
    );
    expect(prevented).toBe(1);
    expect(reloaded).toBe(1);
  });
});
