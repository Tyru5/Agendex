import { type ProductTourStep, TOUR_TARGET } from '@agendex/web';
import { formatForDisplay } from '@tanstack/react-hotkeys';

type DashboardMode = 'local' | 'cloud';

export interface DashboardTourOptions {
  mode: DashboardMode;
  /** Plan-sources topbar action is rendered (local mode, or Pro cloud). */
  canManagePlanSources: boolean;
  /** Desktop cloud/local switch is rendered. */
  canSwitchMode: boolean;
  /** Signed in, so the account menu (not "Sign in") is rendered. */
  hasAccountMenu: boolean;
}

/**
 * Guided tour of the EE dashboard. Steps for controls the current shell does
 * not render are omitted up front so the progress count is accurate; the tour
 * engine still skips any target that is missing at runtime.
 */
export function buildDashboardTourSteps({
  mode,
  canManagePlanSources,
  canSwitchMode,
  hasAccountMenu,
}: DashboardTourOptions): ProductTourStep[] {
  const paletteKey = formatForDisplay('Mod+K');
  const sidebarKey = formatForDisplay('Mod+B');

  const intro: ProductTourStep =
    mode === 'cloud'
      ? {
          title: 'Welcome to Agendex',
          description:
            'Agendex collects the plans your coding agents write on every machine you sync, so you can search, review, and share them from one place. This tour takes about a minute.',
        }
      : {
          title: 'Welcome to Agendex',
          description:
            'You’re viewing plans indexed from this machine. Agendex watches the directories your coding agents write to and keeps this list current. This tour takes about a minute.',
        };

  const planList: ProductTourStep =
    mode === 'cloud'
      ? {
          target: TOUR_TARGET.planList,
          title: 'Synced plans',
          description:
            'Plans synced from your machines land here, newest first, with unseen changes marked. Pin, rename, or group plans into folders from a row’s menu.',
          side: 'right',
          align: 'start',
        }
      : {
          target: TOUR_TARGET.planList,
          title: 'Your plans, live',
          description:
            'Every plan found on this machine shows up here, newest first. New and edited plans appear the moment they change.',
          side: 'right',
          align: 'start',
        };

  const mainPane: ProductTourStep =
    mode === 'cloud'
      ? {
          target: TOUR_TARGET.mainPane,
          title: 'Review and collaborate',
          description:
            'Open a plan to read it with an outline, share a link, leave comments, add tags, file it into a collection, edit it, compare it with another plan, or browse version history.',
          side: 'left',
          align: 'center',
        }
      : {
          target: TOUR_TARGET.mainPane,
          title: 'Read plans here',
          description:
            'Open a plan to read it with a navigable outline, copy or download it, compare two plans side by side, or view the tech chart of the stack the plan touches.',
          side: 'left',
          align: 'center',
        };

  const outro: ProductTourStep = hasAccountMenu
    ? {
        target: TOUR_TARGET.accountMenu,
        title: 'Account and settings',
        description: `Theme, billing, team, and connected machines live under Settings — you can replay this tour from there too. <kbd>${sidebarKey}</kbd> toggles the sidebar.`,
        side: 'bottom',
        align: 'end',
      }
    : {
        title: 'That’s the tour',
        description: `<kbd>${sidebarKey}</kbd> toggles the sidebar and <kbd>${paletteKey}</kbd> opens the palette. Sign in to sync plans across machines and unlock sharing, comments, and collections.`,
      };

  const steps: ProductTourStep[] = [
    intro,
    {
      target: TOUR_TARGET.commandPalette,
      title: 'Search, filter, and commands',
      description: `<kbd>${paletteKey}</kbd> opens the command palette: full-text search across your plans, filters by agent, workspace, date, tags, and collections, plus quick actions like creating or uploading a plan.`,
      side: 'bottom',
      align: 'center',
    },
    planList,
    mainPane,
    {
      target: TOUR_TARGET.activityBrief,
      title: 'Activity brief',
      description:
        'Catch up on what changed since you last looked: new plans, edits, and checklist progress across your agents.',
      side: 'bottom',
      align: 'end',
    },
  ];

  if (canManagePlanSources) {
    steps.push({
      target: TOUR_TARGET.planSources,
      title: 'Plan sources',
      description:
        mode === 'cloud'
          ? 'Review which machines and folders your synced plans come from, and remove plans you no longer need.'
          : 'Point Agendex at any directory of Markdown plans. Custom sources are indexed and watched just like built-in agents.',
      side: 'bottom',
      align: 'end',
    });
  }

  if (canSwitchMode) {
    steps.push({
      target: TOUR_TARGET.planSourceMode,
      title: 'Cloud or local',
      description:
        'Switch between plans synced to your account and plans indexed from this machine.',
      side: 'bottom',
      align: 'end',
    });
  }

  steps.push(
    {
      target: TOUR_TARGET.systemStatus,
      title: 'Sync status',
      description:
        'Check connection health, plan counts, connected machines, and app updates. Run <kbd>agendex start</kbd> on a machine to keep its plans syncing.',
      side: 'bottom',
      align: 'end',
    },
    outro,
  );

  return steps;
}
