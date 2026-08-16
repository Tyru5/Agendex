import { mkdir, stat, writeFile } from 'node:fs/promises';
import { loadConfig, parsePlanDownloadQuery } from '@agendex/shared';
import {
  type CloudPlanDownloadMatch,
  type FetchCloudPlanResult,
  type ListCloudPlansResult,
  fetchCloudPlan as defaultFetchCloudPlan,
  listCloudPlans as defaultListCloudPlans,
} from './api.ts';
import {
  type BrowseAction,
  canPromptForPlanBrowse,
  promptForBrowseAction,
  promptForBrowsePlan,
} from './browse-prompt.ts';
import { createPlanMarkdownContent, type PlanDownloadFormat } from './download-format.ts';
import { sanitizeTerminalText } from './download-prompt.ts';
import { resolveDownloadFormat, writeDownloadedPlan } from './download-write.ts';
import {
  isLocalFileOpenDisabled,
  openLocalFile as defaultOpenLocalFile,
} from './open-local-file.ts';

const USAGE = 'agendex browse [--agent <name>] [--format md|html] [--out <path>] [--force]';

export interface BrowseDeps {
  listCloudPlans: (options: {
    query?: string;
    agent?: string;
    cursor?: string;
  }) => Promise<ListCloudPlansResult>;
  fetchCloudPlan: (query: string, agent?: string) => Promise<FetchCloudPlanResult>;
  log: (message: string) => void;
  error: (message: string) => void;
  writeStdout: (content: string) => void;
  writeFile: (path: string, content: string) => Promise<void>;
  mkdir: (path: string) => Promise<void>;
  stat: typeof stat;
  canPrompt: () => boolean;
  promptSelectPlan: (matches: CloudPlanDownloadMatch[]) => Promise<string | null>;
  promptSelectAction: () => Promise<BrowseAction | null>;
  openLocalFile: (path: string) => boolean | Promise<boolean>;
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
    if (!skippedCommand && token === 'browse' && positionals.length === 0) {
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

function resolveBrowseFilter(
  positionals: string[],
  agentFlag?: string,
): { query?: string; agent?: string } {
  const joined = positionals.join(' ').trim();
  if (agentFlag) return { query: joined || undefined, agent: agentFlag };
  if (!joined) return {};
  const parsed = parsePlanDownloadQuery(joined);
  return {
    query: parsed.query || undefined,
    agent: parsed.agent,
  };
}

async function listBrowsePlanPages(
  listCloudPlansFn: BrowseDeps['listCloudPlans'],
  filter: { query?: string; agent?: string },
): Promise<ListCloudPlansResult> {
  const plans: CloudPlanDownloadMatch[] = [];
  const seen = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  while (true) {
    const listed = await listCloudPlansFn({ ...filter, cursor });
    if (listed.kind !== 'ok') return listed;

    for (const plan of listed.plans) {
      if (seen.has(plan.id)) continue;
      seen.add(plan.id);
      plans.push(plan);
    }

    if (listed.isDone || !listed.continueCursor) {
      return { kind: 'ok', plans, continueCursor: null, isDone: true };
    }
    if (seenCursors.has(listed.continueCursor)) {
      return {
        kind: 'error',
        status: 0,
        message: 'browse list pagination did not advance; retry later',
      };
    }
    seenCursors.add(listed.continueCursor);
    cursor = listed.continueCursor;
  }
}

function writeDeps(deps: {
  log: (message: string) => void;
  error: (message: string) => void;
  writeStdout: (content: string) => void;
  writeFile: (path: string, content: string) => Promise<void>;
  mkdir: (path: string) => Promise<void>;
  stat: typeof stat;
}) {
  return {
    log: deps.log,
    error: deps.error,
    writeStdout: deps.writeStdout,
    writeFile: deps.writeFile,
    mkdir: deps.mkdir,
    stat: deps.stat,
  };
}

export async function runBrowse(args: string[], deps?: Partial<BrowseDeps>): Promise<number> {
  const listCloudPlansFn = deps?.listCloudPlans ?? defaultListCloudPlans;
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
  const canPrompt = deps?.canPrompt ?? canPromptForPlanBrowse;
  const promptSelectPlan = deps?.promptSelectPlan ?? promptForBrowsePlan;
  const promptSelectAction = deps?.promptSelectAction ?? promptForBrowseAction;
  const openLocalFileFn = deps?.openLocalFile ?? defaultOpenLocalFile;

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

  if (!canPrompt()) {
    error(
      '[agendex] interactive browse requires a TTY. Use `agendex download <query>` to save a plan without a prompt.',
    );
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

  const filter = resolveBrowseFilter(positionalArgs(args), agentFlag.value);
  let listed: ListCloudPlansResult;
  try {
    listed = await listBrowsePlanPages(listCloudPlansFn, filter);
  } catch (err) {
    error(`[agendex] browse failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  if (listed.kind === 'auth-expired') {
    error('[agendex] cloud token expired. Run `agendex login` to re-authenticate.');
    return 1;
  }
  if (listed.kind === 'error') {
    error(`[agendex] browse failed: ${listed.message}`);
    return 1;
  }
  if (listed.plans.length === 0) {
    error('[agendex] no cloud plans found');
    return 1;
  }

  const selectedId = await promptSelectPlan(listed.plans);
  if (!selectedId) return 1;

  const fetchSelected = async (): Promise<FetchCloudPlanResult> => {
    return await fetchCloudPlanFn(selectedId);
  };

  const handleFetchError = (result: FetchCloudPlanResult): number | null => {
    if (result.kind === 'auth-expired') {
      error('[agendex] cloud token expired. Run `agendex login` to re-authenticate.');
      return 1;
    }
    if (result.kind === 'not_found' || result.kind === 'ambiguous') {
      error('[agendex] selected plan could not be downloaded; retry with its id');
      return 1;
    }
    if (result.kind === 'error') {
      error(`[agendex] browse failed: ${result.message}`);
      return 1;
    }
    return null;
  };

  while (true) {
    const action = await promptSelectAction();
    if (!action) return 1;

    let result: FetchCloudPlanResult;
    try {
      result = await fetchSelected();
    } catch (err) {
      error(`[agendex] browse failed: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }

    const fetchError = handleFetchError(result);
    if (fetchError !== null) return fetchError;
    if (result.kind !== 'found') return 1;

    if (action === 'view') {
      log(
        `[agendex] viewing "${sanitizeTerminalText(result.plan.title)}" (${sanitizeTerminalText(result.plan.agent)})`,
      );
      writeStdout(createPlanMarkdownContent(result.plan));
      continue;
    }

    if (action === 'open' && outFlag.value === '-') {
      error('[agendex] cannot open a plan written to stdout. Omit --out - or choose Save.');
      return 1;
    }

    const written = await writeDownloadedPlan(
      result.plan,
      format,
      outFlag.value,
      force,
      writeDeps({
        log,
        error,
        writeStdout,
        writeFile: writeFileFn,
        mkdir: mkdirFn,
        stat: statFn,
      }),
    );
    if (!written.ok) return 1;
    if (action === 'save') return 0;

    if (!written.destination) {
      error('[agendex] cannot open a plan written to stdout. Omit --out - or choose Save.');
      return 1;
    }

    const opened = await openLocalFileFn(written.destination);
    if (!opened) {
      if (isLocalFileOpenDisabled()) {
        log('[agendex] File open disabled by AGENDEX_DISABLE_BROWSER=1.');
        return 0;
      }
      error('[agendex] could not open the file on this machine');
      return 1;
    }
    log(`[agendex] opening ${sanitizeTerminalText(written.destination)}`);
    return 0;
  }
}
