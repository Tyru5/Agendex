import { expect, test } from 'bun:test';
import {
  installDesktopQuitLifecycle,
  type DesktopQuitEvent,
  type QuitScheduleFn,
} from './desktop-quit.ts';

function fakeApp() {
  let listener: ((event: DesktopQuitEvent) => void) | undefined;
  const app = {
    on: (_event: 'before-quit', next: (event: DesktopQuitEvent) => void) => {
      listener = next;
    },
    quit: () => {
      app.quits += 1;
    },
    exit: (code = 0) => {
      app.exits.push(code);
    },
    quits: 0,
    exits: [] as number[],
    emitBeforeQuit: () => {
      let preventedDefault = false;
      listener?.({
        preventDefault: () => {
          preventedDefault = true;
        },
      });
      return { preventedDefault };
    },
  };
  return app;
}

const immediateSchedule: QuitScheduleFn = (callback) => {
  callback();
  return {};
};

const neverSchedule: QuitScheduleFn = () => ({ unref: () => undefined });

test('holds the first quit open, then quits once services are stopped', async () => {
  const app = fakeApp();
  let stopped = false;
  installDesktopQuitLifecycle({
    app,
    shutdownServices: async () => {
      stopped = true;
    },
    setTimeoutFn: neverSchedule,
  });

  expect(app.emitBeforeQuit().preventedDefault).toBe(true);
  expect(app.quits).toBe(0);

  await Bun.sleep(0);

  expect(stopped).toBe(true);
  expect(app.quits).toBe(1);
});

test('lets the quit through once shutdown has finished', async () => {
  const app = fakeApp();
  installDesktopQuitLifecycle({
    app,
    shutdownServices: async () => undefined,
    setTimeoutFn: neverSchedule,
  });

  app.emitBeforeQuit();
  await Bun.sleep(0);

  expect(app.emitBeforeQuit().preventedDefault).toBe(false);
});

test('joins an in-flight shutdown instead of starting a second one', async () => {
  const app = fakeApp();
  let shutdowns = 0;
  installDesktopQuitLifecycle({
    app,
    shutdownServices: async () => {
      shutdowns += 1;
      await Bun.sleep(20);
    },
    setTimeoutFn: neverSchedule,
  });

  expect(app.emitBeforeQuit().preventedDefault).toBe(true);
  expect(app.emitBeforeQuit().preventedDefault).toBe(true);
  await Bun.sleep(40);

  expect(shutdowns).toBe(1);
  expect(app.quits).toBe(1);
});

test('quits even when service cleanup rejects', async () => {
  const app = fakeApp();
  const logged: string[] = [];
  installDesktopQuitLifecycle({
    app,
    shutdownServices: async () => {
      throw new Error('daemon stop blew up');
    },
    setTimeoutFn: neverSchedule,
    log: (message) => logged.push(message),
  });

  app.emitBeforeQuit();
  await Bun.sleep(0);

  expect(app.quits).toBe(1);
  expect(logged[0]).toContain('failed to stop desktop services');
});

test('forces an exit when the quit itself never completes', async () => {
  const app = fakeApp();
  installDesktopQuitLifecycle({
    app,
    shutdownServices: async () => undefined,
    setTimeoutFn: immediateSchedule,
  });

  app.emitBeforeQuit();
  await Bun.sleep(0);

  expect(app.quits).toBe(1);
  expect(app.exits).toEqual([0]);
});
