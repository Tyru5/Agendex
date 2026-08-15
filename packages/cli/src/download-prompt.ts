import { cancel, isCancel, select } from '@clack/prompts';
import type { CloudPlanDownloadMatch } from './api.ts';

export function canPromptForPlanDownload(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export function formatPlanDownloadChoice(match: CloudPlanDownloadMatch, index: number): string {
  return `[${index}] ${match.title}  (${match.agent})`;
}

export function formatPlanDownloadRetry(match: CloudPlanDownloadMatch): string {
  return `      agendex download ${match.id}`;
}

export async function promptForPlanDownload(
  matches: CloudPlanDownloadMatch[],
  message: string,
): Promise<string | null> {
  if (matches.length === 0) return null;

  const selected = await select({
    message,
    options: matches.map((match, index) => ({
      value: match.id,
      label: formatPlanDownloadChoice(match, index + 1),
      hint: match.localPlanId ? `local ${match.localPlanId}` : match.id,
    })),
  });

  if (isCancel(selected) || typeof selected !== 'string') {
    cancel('Download cancelled.');
    return null;
  }

  return selected;
}
