import { formatForDisplay } from '@tanstack/react-hotkeys';
import { type ProductTourStep, TOUR_TARGET } from '@agendex/web';

/** Guided tour of the local (OSS) workspace shell. */
export function buildLocalWorkspaceTourSteps(): ProductTourStep[] {
  const sidebarKey = formatForDisplay('Mod+B');
  const outlineKey = formatForDisplay('Mod+Shift+O');
  return [
    {
      title: 'Welcome to Agendex',
      description:
        'Agendex watches the plan files your coding agents write — Claude Code, Codex, Cursor, and many more — and indexes them into one searchable workspace. Everything stays on this machine. This tour takes about a minute.',
    },
    {
      target: TOUR_TARGET.planList,
      title: 'Your plans, live',
      description:
        'Every plan Agendex finds shows up here, newest first. Agent directories are watched, so new and edited plans appear the moment they change. Pin plans or group them into folders from a row’s menu.',
      side: 'right',
      align: 'start',
    },
    {
      target: TOUR_TARGET.search,
      title: 'Full-text search',
      description:
        'Search plan titles and bodies. Press <kbd>/</kbd> anywhere to jump to this field.',
      side: 'right',
      align: 'start',
    },
    {
      target: TOUR_TARGET.agentFilter,
      title: 'Filter by agent',
      description:
        'Narrow the list to one or more agents. Counts update as plans are indexed. Choose “All plans” to clear the selection.',
      side: 'right',
      align: 'start',
    },
    {
      target: TOUR_TARGET.filters,
      title: 'Workspace, date, and sort',
      description:
        'Scope plans to a project, a time window, or reorder by updated, created, or title. Active filters appear as chips above the list; remove them one at a time or clear all.',
      side: 'right',
      align: 'start',
    },
    {
      target: TOUR_TARGET.mainPane,
      title: 'Read plans here',
      description: `Open a plan to read it with a navigable outline (<kbd>${outlineKey}</kbd> toggles it), copy or download it, compare two plans side by side, or view the tech chart of the stack the plan touches.`,
      side: 'left',
      align: 'center',
    },
    {
      target: TOUR_TARGET.planSources,
      title: 'Add your own plan folders',
      description:
        'Point Agendex at any directory of Markdown plans. Custom sources are indexed and watched just like built-in agents.',
      side: 'bottom',
      align: 'end',
    },
    {
      target: TOUR_TARGET.workspaceStatus,
      title: 'Connection and index status',
      description:
        'See how many plans are indexed, which agents are active, and whether the local server is live. If the backend goes offline, Agendex reconnects on its own.',
      side: 'bottom',
      align: 'end',
    },
    {
      target: TOUR_TARGET.replayTour,
      title: 'That’s the tour',
      description: `<kbd>${sidebarKey}</kbd> toggles the sidebar and <kbd>/</kbd> focuses search. Replay this walkthrough anytime from this button.`,
      side: 'bottom',
      align: 'end',
    },
  ];
}
