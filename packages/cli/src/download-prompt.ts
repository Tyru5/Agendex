import { cancel, isCancel, select } from '@clack/prompts';
import type { CloudPlanDownloadMatch } from './api.ts';

const ANSI_CSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const ANSI_OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g;
const ANSI_FE = /\u001b[@-Z\\-_]/g;
const TERMINAL_UNSAFE = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

/** Strip CSI/OSC and other control chars from cloud metadata before TTY output. */
export function sanitizeTerminalText(value: string): string {
  return value
    .replace(ANSI_CSI, '')
    .replace(ANSI_OSC, '')
    .replace(ANSI_FE, '')
    .replace(TERMINAL_UNSAFE, '');
}

export function canPromptForPlanDownload(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export function formatPlanDownloadChoice(match: CloudPlanDownloadMatch, index: number): string {
  return `[${index}] ${sanitizeTerminalText(match.title)}  (${sanitizeTerminalText(match.agent)})`;
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
