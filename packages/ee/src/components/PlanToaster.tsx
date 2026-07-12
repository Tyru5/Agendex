import { useTheme } from '@agendex/web';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Toaster } from 'sonner';
import {
  clearAllPlanToasts,
  getActivePlanToastCount,
  subscribePlanToastStore,
} from '../hooks/plan-toast-store.ts';
import { maxVisibleToasts, shouldShowClearAll } from '../hooks/unseen-plan-toast-utils.ts';

const TOAST_EDGE_OFFSET_PX = 16;
const CLEAR_ALL_BAR_HEIGHT_PX = 40;

function useViewportVisibleToasts() {
  const [visible, setVisible] = useState(() =>
    typeof window === 'undefined' ? 3 : maxVisibleToasts(window.innerHeight),
  );

  useEffect(() => {
    const update = () => setVisible(maxVisibleToasts(window.innerHeight));
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return visible;
}

export function PlanToaster() {
  const { resolvedTheme } = useTheme();
  const activeCount = useSyncExternalStore(
    subscribePlanToastStore,
    getActivePlanToastCount,
    () => 0,
  );
  const visibleToasts = useViewportVisibleToasts();
  const showClearAll = shouldShowClearAll(activeCount);
  // Lift the toast stack when Clear all is present so the control sits under it.
  const toastOffset = showClearAll
    ? TOAST_EDGE_OFFSET_PX + CLEAR_ALL_BAR_HEIGHT_PX
    : TOAST_EDGE_OFFSET_PX;

  return (
    <>
      {showClearAll && (
        <div
          className="pointer-events-none fixed right-4 bottom-4 z-[100] flex w-[min(360px,calc(100vw-2rem))] justify-end"
          data-plan-toast-clear-all
        >
          <button
            type="button"
            onClick={() => clearAllPlanToasts()}
            className="pointer-events-auto rounded-md border border-border bg-surface px-2.5 py-1 text-[12px] font-semibold text-tertiary shadow-[0_8px_20px_-10px_rgba(0,0,0,0.35)] transition-colors hover:bg-hover hover:text-text"
          >
            Clear all
          </button>
        </div>
      )}
      <Toaster
        position="bottom-right"
        theme={resolvedTheme}
        visibleToasts={visibleToasts}
        offset={toastOffset}
        closeButton
        toastOptions={{
          unstyled: true,
          classNames: {
            toast:
              'relative flex w-[min(360px,calc(100vw-2rem))] items-start gap-3 rounded-xl border border-border bg-surface px-3.5 py-3 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.35)] cursor-pointer',
            title: 'text-[13px] font-semibold text-text leading-snug',
            description: 'text-[12px] text-tertiary leading-snug',
            actionButton:
              'shrink-0 rounded-md px-2 py-1 text-[12px] font-semibold text-[var(--accent)] hover:bg-hover transition-colors',
            closeButton:
              'absolute right-2 top-2 rounded-md p-1 text-tertiary hover:text-text hover:bg-hover transition-colors',
          },
        }}
      />
    </>
  );
}
