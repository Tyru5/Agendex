import { describe, expect, test } from 'bun:test';
import { installDesktopProtocolLifecycle } from './desktop-protocol-lifecycle.ts';

type OpenUrlListener = (event: { readonly preventDefault: () => void }, rawUrl: string) => void;
type SecondInstanceListener = (event: unknown, commandLine: readonly string[]) => void;

function createLifecycleHarness(
  options: {
    readonly ready?: boolean;
    readonly secondInstanceHasCallback?: boolean;
  } = {},
) {
  const order: string[] = [];
  const protocolClientCalls: Array<readonly unknown[]> = [];
  const drains: string[] = [];
  const reopens: string[] = [];
  const handledArgv: Array<readonly string[]> = [];
  let openUrlListener: OpenUrlListener = () => undefined;
  let secondInstanceListener: SecondInstanceListener = () => undefined;
  let ready = options.ready ?? false;
  let resolveReady = (): void => undefined;
  const readyPromise = new Promise<void>((resolve) => {
    resolveReady = () => {
      ready = true;
      resolve();
    };
  });

  installDesktopProtocolLifecycle({
    app: {
      isReady: () => ready,
      on: (
        event: 'open-url' | 'second-instance',
        listener: OpenUrlListener | SecondInstanceListener,
      ) => {
        order.push(`on:${event}`);
        if (event === 'open-url') openUrlListener = listener as OpenUrlListener;
        else secondInstanceListener = listener as SecondInstanceListener;
      },
      setAsDefaultProtocolClient: (...args: unknown[]) => {
        protocolClientCalls.push(args);
        return true;
      },
      whenReady: async () => {
        order.push('whenReady');
        await readyPromise;
      },
    },
    controller: {
      enqueueProtocolUrl: (rawUrl: string) => rawUrl.startsWith('agendex://auth/callback'),
      handleCommandLine: (argv: readonly string[]) => {
        handledArgv.push(argv);
        return (
          options.secondInstanceHasCallback ?? argv.some((arg) => arg.startsWith('agendex://'))
        );
      },
      drainQueuedCallbacks: async () => {
        drains.push('drain');
      },
    },
    processInfo: {
      isDefaultApp: true,
      execPath: '/usr/local/bin/electron',
      argv: ['/electron', '/repo/packages/desktop'],
    },
    startBackendWindowAndDrainProtocolCallbacks: async () => {
      drains.push('start-and-drain');
    },
    reopenFromSecondInstance: async () => {
      reopens.push('reopen');
    },
    logError: () => undefined,
    quit: () => undefined,
  });

  return {
    order,
    protocolClientCalls,
    drains,
    reopens,
    handledArgv,
    resolveReady,
    openUrl: (rawUrl: string) => {
      let prevented = false;
      openUrlListener(
        {
          preventDefault: () => {
            prevented = true;
          },
        },
        rawUrl,
      );
      return prevented;
    },
    secondInstance: (argv: readonly string[]) => secondInstanceListener({}, argv),
  };
}

describe('desktop protocol Electron lifecycle wiring', () => {
  test('Given lifecycle install When app becomes ready Then open-url is registered before protocol client registration', async () => {
    const harness = createLifecycleHarness();

    harness.resolveReady();
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.order).toEqual(['on:open-url', 'on:second-instance', 'whenReady']);
    expect(harness.handledArgv).toEqual([['/electron', '/repo/packages/desktop']]);
    expect(harness.protocolClientCalls).toEqual([
      ['agendex', '/usr/local/bin/electron', ['/repo/packages/desktop']],
    ]);
  });

  test('Given app is not ready When open-url callback arrives Then it queues without draining', () => {
    const harness = createLifecycleHarness({ ready: false });

    const prevented = harness.openUrl('agendex://auth/callback?state=s');

    expect(prevented).toBe(true);
    expect(harness.drains).toEqual([]);
  });

  test('Given app is ready When open-url callback arrives Then it starts backend and drains', () => {
    const harness = createLifecycleHarness({ ready: true });

    const prevented = harness.openUrl('agendex://auth/callback?state=s');

    expect(prevented).toBe(true);
    expect(harness.drains).toEqual(['start-and-drain']);
  });

  test('Given second instance argv has callback When handling it Then it drains instead of reopening', () => {
    const harness = createLifecycleHarness();

    harness.secondInstance(['Agendex', 'agendex://auth/callback?state=s']);

    expect(harness.drains).toEqual(['start-and-drain']);
    expect(harness.reopens).toEqual([]);
  });

  test('Given second instance argv has no callback When handling it Then it reopens the dashboard', () => {
    const harness = createLifecycleHarness({ secondInstanceHasCallback: false });

    harness.secondInstance(['Agendex']);

    expect(harness.drains).toEqual([]);
    expect(harness.reopens).toEqual(['reopen']);
  });
});
