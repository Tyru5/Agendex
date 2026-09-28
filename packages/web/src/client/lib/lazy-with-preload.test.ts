import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { type ComponentType, createElement, Suspense } from 'react';
import { renderToString } from 'react-dom/server';
import { lazyWithPreload, recoverFromChunkLoadError } from './lazy-with-preload.ts';

function Stub() {
  return createElement('p', null, 'loaded');
}

function renderInSuspense(component: ComponentType): string {
  return renderToString(
    createElement(
      Suspense,
      { fallback: createElement('p', null, 'fallback') },
      createElement(component),
    ),
  );
}

const originalWindow = globalThis.window;
const originalSessionStorage = globalThis.sessionStorage;
let reload: ReturnType<typeof mock>;
let store: Map<string, string>;

beforeEach(() => {
  reload = mock(() => {});
  store = new Map();
  Object.defineProperty(globalThis, 'window', {
    value: { location: { reload } },
    configurable: true,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    },
    configurable: true,
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: originalSessionStorage,
    configurable: true,
  });
});

test('preload downloads a chunk once and shares it with every caller', async () => {
  const load = mock(() => Promise.resolve(Stub));
  const Component = lazyWithPreload(load);

  const [first, second] = await Promise.all([Component.preload(), Component.preload()]);

  expect(load).toHaveBeenCalledTimes(1);
  expect(first).toBe(second);
  expect(first).toEqual({ default: Stub });
});

test('renders an already-loaded chunk directly instead of suspending first', async () => {
  const Component = lazyWithPreload(() => Promise.resolve(Stub));
  expect(renderInSuspense(Component)).toContain('fallback');

  await Component.preload();

  expect(renderInSuspense(Component)).toContain('loaded');
});

test('a failed preload is forgotten so the next attempt retries the download', async () => {
  let attempts = 0;
  const Component = lazyWithPreload(() => {
    attempts += 1;
    return attempts === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(Stub);
  });

  await expect(Component.preload()).rejects.toThrow('offline');
  await expect(Component.preload()).resolves.toEqual({ default: Stub });
  expect(attempts).toBe(2);
});

test('a stale chunk reloads the page once instead of surfacing the error', async () => {
  const pending = recoverFromChunkLoadError(
    new Error('Failed to fetch dynamically imported module'),
  );
  const settled = await Promise.race([
    pending.then(
      () => 'settled',
      () => 'settled',
    ),
    Bun.sleep(5),
  ]);

  expect(reload).toHaveBeenCalledTimes(1);
  // The promise never settles, so Suspense keeps its fallback until the reload lands.
  expect(settled).toBeUndefined();
});

test('a chunk that still fails right after a reload surfaces the error instead of looping', async () => {
  store.set('agendex_chunk_reload_at', String(Date.now()));
  const error = new Error('Failed to fetch dynamically imported module');

  await expect(recoverFromChunkLoadError(error)).rejects.toBe(error);
  expect(reload).not.toHaveBeenCalled();
});
