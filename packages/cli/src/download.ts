import { mkdir, stat, writeFile } from 'node:fs/promises';
import { loadConfig, looksLikePlanAgent, parsePlanDownloadQuery } from '@agendex/shared';
import {
  type CloudPlanDownloadMatch,
  type CloudPlanDownloadPagination,
  type FetchCloudPlanResult,
  fetchCloudPlan as defaultFetchCloudPlan,
} from './api.ts';
import { type PlanDownloadFormat } from './download-format.ts';
import {
  canPromptForPlanDownload,
  formatPlanDownloadChoice,
  formatPlanDownloadRetry,
  promptForPlanDownload,
  sanitizeTerminalText,
} from './download-prompt.ts';
import { resolveDownloadFormat, writeDownloadedPlan } from './download-write.ts';

export { isUsableLaunchPath } from './download-write.ts';

const USAGE =
  'agendex download <query> [--agent <name>] [--format md|html] [--out <path>] [--force]';

export interface DownloadDeps {
  fetchCloudPlan: (query: string, agent?: string) => Promise<FetchCloudPlanResult>;
  log: (message: string) => void;
  error: (message: string) => void;
  writeStdout: (content: string) => void;
  writeFile: (path: string, content: string) => Promise<void>;
  mkdir: (path: string) => Promise<void>;
  stat: typeof stat;
  canPrompt: () => boolean;
  promptSelect: (matches: CloudPlanDownloadMatch[], message: string) => Promise<string | null>;
}

type FlagParse = { kind: 'ok'; value?: string } | { kind: 'missing'; flag: string };

function flagValue(args: string[], flag: string): FlagParse {
  const idx = args.indexOf(flag);
  if (idx === -1) return { kind: 'ok' };
  const value = args[idx + 1];
  if (value === undefined || value.startsWith('--')) return { kind: 'missing', flag };
  return { kind: 'ok', value };
}

function positionalArgs(args: string[]): string[] {
  const skipNext = new Set(['--agent', '--format', '--out']);
  const positionals: string[] = [];
  let skippedCommand = false;
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === undefined) continue;
    if (token === '--dev') continue;
    // Skip the command name once; later "download" tokens are the query.
    if (!skippedCommand && token === 'download' && positionals.length === 0) {
      skippedCommand = true;
      continue;
    }
    if (skipNext.has(token)) {
      i++;
      continue;
    }
    if (token.startsWith('--')) continue;
    positionals.push(token);
  }
  return positionals;
}

type QueryAttempt = { query: string; agent?: string };

function resolveQueryAttempts(positionals: string[], agentFlag?: string): QueryAttempt[] {
  const joined = positionals.join(' ').trim();
  if (!joined) return [{ query: '' }];
  if (agentFlag) return [{ query: joined, agent: agentFlag }];

  if (positionals.length === 2) {
    const first = positionals[0] ?? '';
    const second = positionals[1] ?? '';
    const firstIsAgent = looksLikePlanAgent(first);
    const secondIsAgent = looksLikePlanAgent(second);
    if (firstIsAgent && !secondIsAgent) {
      // Prefer the full title so `"cursor setup"` still matches after the
      // shell splits it, then fall back to leading-agent shorthand.
      return [{ query: joined }, { query: second, agent: first }];
    }
    if (secondIsAgent && !firstIsAgent) {
      // Prefer the full title so `Deploy cursor` can match, then fall back
      // to trailing-agent shorthand (`Auth claude-code`).
      return [{ query: joined }, { query: first, agent: second }];
    }
  }

  const parsed = parsePlanDownloadQuery(joined);
  return [{ query: parsed.query, agent: parsed.agent }];
}

function formatQuickSelectList(matches: CloudPlanDownloadMatch[]): string[] {
  return matches.flatMap((match, index) => [
    `  ${formatPlanDownloadChoice(match, index + 1)}`,
    formatPlanDownloadRetry(match),
  ]);
}

function formatAmbiguousMatches(
  matches: CloudPlanDownloadMatch[],
  pagination: CloudPlanDownloadPagination,
): string {
  const lines =
    matches.length === 0
      ? ['[agendex] multiple plans matched; retry with an exact plan id']
      : [
          '[agendex] multiple plans matched — pick one without retyping the title:',
          ...formatQuickSelectList(matches),
        ];
  if (pagination.hasMore) {
    lines.push(
      `[agendex] showing up to ${pagination.pageSize} matches; more exact-title matches exist. Refine with --agent or use an exact plan id.`,
    );
  }
  return lines.join('\n');
}

function formatNotFound(
  query: string,
  agent: string | undefined,
  suggestions: CloudPlanDownloadMatch[],
): string {
  const lines = [
    `[agendex] no plan found for ${JSON.stringify(sanitizeTerminalText(query))}${
      agent ? ` (agent ${sanitizeTerminalText(agent)})` : ''
    }`,
  ];
  if (suggestions.length === 0) return lines.join('\n');
  lines.push('[agendex] closest matches — pick one without retyping the title:');
  lines.push(...formatQuickSelectList(suggestions));
  return lines.join('\n');
}

export async function runDownload(args: string[], deps?: Partial<DownloadDeps>): Promise<number> {
  const fetchCloudPlanFn = deps?.fetchCloudPlan ?? defaultFetchCloudPlan;
  const log = deps?.log ?? ((message: string) => console.log(message));
  const error = deps?.error ?? ((message: string) => console.error(message));
  const writeStdout = deps?.writeStdout ?? ((content: string) => process.stdout.write(content));
  const force = args.includes('--force');
  const writeFileFn =
    deps?.writeFile ??
    ((path: string, content: string) =>
      writeFile(path, content, { encoding: 'utf8', flag: force ? 'w' : 'wx' }));
  const mkdirFn =
    deps?.mkdir ?? ((path: string) => mkdir(path, { recursive: true }).then(() => undefined));
  const statFn = deps?.stat ?? stat;
  const canPrompt = deps?.canPrompt ?? canPromptForPlanDownload;
  const promptSelect = deps?.promptSelect ?? promptForPlanDownload;

  const agentFlag = flagValue(args, '--agent');
  if (agentFlag.kind === 'missing') {
    error(`[agendex] usage: ${USAGE}`);
    error('[agendex] --agent requires a name');
    return 1;
  }

  const formatFlag = flagValue(args, '--format');
  if (formatFlag.kind === 'missing') {
    error(`[agendex] usage: ${USAGE}`);
    error('[agendex] --format requires md or html');
    return 1;
  }

  const outFlag = flagValue(args, '--out');
  if (outFlag.kind === 'missing') {
    error(`[agendex] usage: ${USAGE}`);
    error('[agendex] --out requires a path');
    return 1;
  }

  const attempts = resolveQueryAttempts(positionalArgs(args), agentFlag.value);
  const initialAttempt = attempts[0];
  if (!initialAttempt?.query) {
    error(`[agendex] usage: ${USAGE}`);
    return 1;
  }

  const resolvedFormat = await resolveDownloadFormat({
    formatFlag: formatFlag.value,
    outArg: outFlag.value,
    stat: statFn,
  });
  if (resolvedFormat.kind === 'error') {
    error(resolvedFormat.message);
    return 1;
  }
  const format: PlanDownloadFormat = resolvedFormat.format;

  const config = loadConfig();
  if (!config?.cloudToken || !config?.convexUrl) {
    error('[agendex] not logged in. Run `agendex login` first.');
    return 1;
  }

  let query = initialAttempt.query;
  let agent = initialAttempt.agent;
  let result: FetchCloudPlanResult | undefined;
  let firstMiss: { query: string; agent?: string; result: FetchCloudPlanResult } | undefined;
  let pendingAmbiguous: { query: string; agent?: string; result: FetchCloudPlanResult } | undefined;
  try {
    for (const attempt of attempts) {
      query = attempt.query;
      agent = attempt.agent;
      result = await fetchCloudPlanFn(attempt.query, attempt.agent);
      if (result.kind === 'found' || result.kind === 'auth-expired' || result.kind === 'error') {
        break;
      }
      if (result.kind === 'ambiguous') {
        pendingAmbiguous = { query: attempt.query, agent: attempt.agent, result };
        continue;
      }
      firstMiss ??= { query: attempt.query, agent: attempt.agent, result };
    }
    if (result?.kind === 'not_found' && pendingAmbiguous) {
      query = pendingAmbiguous.query;
      agent = pendingAmbiguous.agent;
      result = pendingAmbiguous.result;
    } else if (result?.kind === 'not_found' && firstMiss) {
      query = firstMiss.query;
      agent = firstMiss.agent;
      result = firstMiss.result;
    }
  } catch (err) {
    error(`[agendex] download failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  if (!result) {
    error('[agendex] download failed: no lookup result');
    return 1;
  }

  if (result.kind === 'auth-expired') {
    error('[agendex] cloud token expired. Run `agendex login` to re-authenticate.');
    return 1;
  }

  const choices =
    result.kind === 'not_found'
      ? result.suggestions
      : result.kind === 'ambiguous'
        ? result.matches
        : [];
  if (result.kind === 'not_found' || result.kind === 'ambiguous') {
    error(
      result.kind === 'not_found'
        ? formatNotFound(query, agent, result.suggestions)
        : formatAmbiguousMatches(result.matches, result.pagination),
    );
    if (choices.length === 0 || !canPrompt()) return 1;

    const selectedId = await promptSelect(
      choices,
      result.kind === 'not_found'
        ? 'Download which closest match?'
        : 'Download which matching plan?',
    );
    if (!selectedId) return 1;

    try {
      result = await fetchCloudPlanFn(selectedId);
    } catch (err) {
      error(`[agendex] download failed: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }

  if (result.kind === 'auth-expired') {
    error('[agendex] cloud token expired. Run `agendex login` to re-authenticate.');
    return 1;
  }
  if (result.kind === 'not_found' || result.kind === 'ambiguous') {
    error('[agendex] selected plan could not be downloaded; retry with its id');
    return 1;
  }
  if (result.kind === 'error') {
    error(`[agendex] download failed: ${result.message}`);
    return 1;
  }

  const written = await writeDownloadedPlan(result.plan, format, outFlag.value, force, {
    log,
    error,
    writeStdout,
    writeFile: writeFileFn,
    mkdir: mkdirFn,
    stat: statFn,
  });
  return written.ok ? 0 : 1;
}
