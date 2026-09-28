import {
  type ComponentProps,
  type ComponentType,
  createElement,
  lazy,
  type ReactElement,
  useState,
} from 'react';

// oxlint-disable-next-line typescript/no-explicit-any -- mirrors React.lazy's own constraint
type AnyComponent = ComponentType<any>;

export type PreloadableComponent<T extends AnyComponent> = ((
  props: ComponentProps<T>,
) => ReactElement) & {
  /** Starts downloading the component's chunk without rendering it. */
  preload: () => Promise<unknown>;
};

const CHUNK_RELOAD_AT_KEY = 'agendex_chunk_reload_at';
const CHUNK_RELOAD_COOLDOWN_MS = 10_000;

/**
 * A deploy replaces the hashed chunks an already-open tab still points at, so
 * its next lazy import 404s. Reloading once picks up the new build; the
 * cooldown stops a genuinely broken chunk from reload-looping.
 */
export function recoverFromChunkLoadError(error: unknown): Promise<never> {
  try {
    const lastReloadAt = Number(sessionStorage.getItem(CHUNK_RELOAD_AT_KEY) ?? 0);
    if (Date.now() - lastReloadAt > CHUNK_RELOAD_COOLDOWN_MS) {
      sessionStorage.setItem(CHUNK_RELOAD_AT_KEY, String(Date.now()));
      window.location.reload();
      // Keep the Suspense fallback up until the reload replaces the page.
      return new Promise<never>(() => {});
    }
  } catch {
    // Storage unavailable: surface the original error instead of guessing.
  }
  return Promise.reject(error);
}

/**
 * `React.lazy` plus `preload()`, so a chunk can be fetched before it renders:
 * alongside a sibling lazy boundary instead of after it, before the first
 * render, or while the browser is idle ahead of a likely navigation. A failed
 * preload is forgotten so the render can retry; a failed render reloads once
 * onto the current build.
 */
export function lazyWithPreload<T extends AnyComponent>(
  load: () => Promise<T>,
): PreloadableComponent<T> {
  let loaded: T | undefined;
  let pending: Promise<{ default: T }> | undefined;
  const preload = () => {
    pending ??= load().then(
      (component) => {
        loaded = component;
        return { default: component };
      },
      (error: unknown) => {
        pending = undefined;
        throw error;
      },
    );
    return pending;
  };
  const Lazy = lazy(() => preload().catch(recoverFromChunkLoadError));

  function Preloadable(props: ComponentProps<T>) {
    // An already-loaded chunk renders directly. Suspending on it anyway would
    // commit the Suspense fallback first, and React then holds the real
    // content back for up to 300ms (its fallback reveal throttle). The choice
    // is fixed per mount so an instance never swaps component types.
    const [Loaded] = useState(() => loaded);
    return createElement((Loaded ?? Lazy) as AnyComponent, props);
  }
  return Object.assign(Preloadable, { preload });
}

/** Preloads chunks without surfacing failures; the eventual render retries. */
export function preloadComponents(
  components: readonly { preload: () => Promise<unknown> }[],
): void {
  for (const component of components) component.preload().catch(() => undefined);
}

/**
 * Runs `task` once the main thread is idle, so speculative work never competes
 * with the current page. Returns a cancel function for effect cleanup.
 */
export function whenIdle(task: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(task, { timeout: 3_000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(task, 1_500);
  return () => window.clearTimeout(id);
}
