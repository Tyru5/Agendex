import { type Driver, type DriveStep, driver } from 'driver.js';

/**
 * Bump when the tour content changes enough that returning users should see
 * it again. Persisted per user (cloud) or per browser (local) as the highest
 * version completed.
 */
export const PRODUCT_TOUR_VERSION = 1;

/** Stable DOM hooks the tour attaches to. Rendered as `data-tour="<id>"`. */
export const TOUR_TARGET = {
  search: 'search',
  agentFilter: 'agent-filter',
  filters: 'filters',
  planList: 'plan-list',
  mainPane: 'main-pane',
  planSources: 'plan-sources',
  workspaceStatus: 'workspace-status',
  commandPalette: 'command-palette',
  activityBrief: 'activity-brief',
  systemStatus: 'system-status',
  accountMenu: 'account-menu',
  planSourceMode: 'plan-source-mode',
  replayTour: 'replay-tour',
} as const;

export type TourTarget = (typeof TOUR_TARGET)[keyof typeof TOUR_TARGET];

export function tourTargetSelector(target: TourTarget): string {
  return `[data-tour="${target}"]`;
}

export interface ProductTourStep {
  /** Omit for a centered, element-less step (intro / outro). */
  target?: TourTarget;
  title: string;
  /** Plain text or trusted HTML authored in-repo; never user content. */
  description: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}

export interface ProductTourState {
  /** Highest completed version; `null` when never completed; `undefined` while loading. */
  completedVersion: number | null | undefined;
  markCompleted: (version: number) => void | Promise<void>;
}

export function isProductTourPending(state: ProductTourState): boolean {
  if (state.completedVersion === undefined) return false;
  return (state.completedVersion ?? 0) < PRODUCT_TOUR_VERSION;
}

export const PRODUCT_TOUR_POPOVER_CLASS = 'agendex-tour';

function toDriveStep(step: ProductTourStep): DriveStep {
  return {
    element: step.target ? tourTargetSelector(step.target) : undefined,
    popover: {
      title: step.title,
      description: step.description,
      side: step.side,
      align: step.align,
    },
  };
}

/**
 * Creates and starts a driver.js tour. `onFinish` fires exactly once when the
 * user ends the tour (Finish, close, Escape, or overlay click). A programmatic
 * `destroy()` (shell unmounting mid-tour) does not count as finishing, so the
 * tour resumes on the next visit. Returns the driver so callers can destroy it.
 */
export function startProductTour(
  steps: readonly ProductTourStep[],
  { onFinish }: { onFinish: () => void },
): Driver {
  const tour = driver({
    steps: steps.map(toDriveStep),
    popoverClass: PRODUCT_TOUR_POPOVER_CLASS,
    animate: true,
    duration: 260,
    overlayOpacity: 0.55,
    stagePadding: 6,
    stageRadius: 10,
    showProgress: true,
    progressText: '{{current}} of {{total}}',
    nextBtnText: 'Next',
    prevBtnText: 'Back',
    doneBtnText: 'Finish',
    // Steps whose control isn't rendered in this shell/mode are skipped rather
    // than shown as an orphaned centered popover.
    skipMissingElement: true,
    waitForElement: 400,
    disableActiveInteraction: true,
    // `onDestroyed` is skipped by driver.js when teardown happens mid-transition
    // (e.g. Escape during the first fade-in); `onDestroyStarted` always runs for
    // user-initiated teardown, so completion is recorded there.
    //
    // This hook only fires for driver-internal teardown (Finish/Done, close
    // button, Escape, overlay click). The public `Driver.destroy()` calls the
    // internal destroy with the hook disabled, which is also how `active.destroy()`
    // below avoids re-entering this callback. A programmatic `destroy()` from the
    // shell therefore never records completion.
    onDestroyStarted: (_element, _step, { driver: active }) => {
      onFinish();
      active.destroy();
    },
  });
  tour.drive();
  return tour;
}
