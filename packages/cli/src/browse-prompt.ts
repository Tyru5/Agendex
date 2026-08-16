import { autocomplete, cancel, isCancel, select } from '@clack/prompts';
import type { CloudPlanDownloadMatch } from './api.ts';
import { canPromptForPlanDownload, formatPlanDownloadChoice } from './download-prompt.ts';

export type BrowseAction = 'view' | 'save' | 'open';

export function canPromptForPlanBrowse(): boolean {
  return canPromptForPlanDownload();
}

export async function promptForBrowsePlan(
  matches: CloudPlanDownloadMatch[],
): Promise<string | null> {
  if (matches.length === 0) return null;

  const selected = await autocomplete({
    message: 'Select a plan',
    placeholder: 'Type to filter plans...',
    maxItems: 7,
    options: matches.map((match, index) => ({
      value: match.id,
      label: formatPlanDownloadChoice(match, index + 1),
      hint: match.localPlanId ? `local ${match.localPlanId}` : match.id,
    })),
  });

  if (isCancel(selected) || typeof selected !== 'string') {
    cancel('Browse cancelled.');
    return null;
  }

  return selected;
}

export async function promptForBrowseAction(): Promise<BrowseAction | null> {
  const selected = await select({
    message: 'What do you want to do?',
    options: [
      { value: 'view', label: 'View in terminal' },
      { value: 'save', label: 'Save to disk' },
      { value: 'open', label: 'Open on this machine' },
    ],
  });

  if (isCancel(selected) || typeof selected !== 'string') {
    cancel('Browse cancelled.');
    return null;
  }

  if (selected === 'view' || selected === 'save' || selected === 'open') return selected;
  return null;
}
