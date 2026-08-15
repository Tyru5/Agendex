import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import {
  isHomeRelativePath,
  loadConfig,
  looksLikePlanAgent,
  parsePlanDownloadQuery,
  resolveCustomPlanDirPath,
} from '@agendex/shared';
import {
  type CloudPlanDownload,
  type CloudPlanDownloadMatch,
  type FetchCloudPlanResult,
  fetchCloudPlan as defaultFetchCloudPlan,
} from './api.ts';
import {
  type PlanDownloadFormat,
  createPlanDownloadFilename,
  inferPlanDownloadFormat,
  parsePlanDownloadFormat,
  renderPlanDownload,
} from './download-format.ts';
import {
  canPromptForPlanDownload,
  formatPlanDownloadChoice,
  formatPlanDownloadRetry,
  promptForPlanDownload,
  sanitizeTerminalText,
} from './download-prompt.ts';

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

function resolveQueryAndAgent(
  positionals: string[],
  agentFlag?: string,
): { query: string; agent?: string } {
  if (positionals.length === 2) {
    const first = positionals[0] ?? '';
    const second = positionals[1] ?? '';
    const firstIsAgent = looksLikePlanAgent(first);
    const secondIsAgent = looksLikePlanAgent(second);
    if (firstIsAgent && !secondIsAgent) {
      return { query: second, agent: agentFlag ?? first };
    }
    // Trailing agent only after a quoted/multi-word title. Unquoted
    // `Deploy cursor` must stay a title, not an agent filter.
    if (secondIsAgent && !firstIsAgent && /\s/.test(first)) {
      return { query: first, agent: agentFlag ?? second };
    }
  }

  const joined = positionals.join(' ').trim();
  if (agentFlag) {
    return { query: joined, agent: agentFlag };
  }
  const parsed = parsePlanDownloadQuery(joined);
  return {
    query: parsed.query,
    agent: parsed.agent,
  };
}

export function isUsableLaunchPath(pathArg: string, platform = process.platform): boolean {
  if (platform !== 'win32') return true;
  return /^[A-Za-z]:[\\/]/.test(pathArg) || pathArg.startsWith('\\\\');
}

function resolveLaunchCwd(): string {
  const initCwd = process.env.INIT_CWD?.trim();
  if (initCwd && isAbsolute(initCwd) && isUsableLaunchPath(initCwd)) return initCwd;

  const shellPwd = process.env.PWD?.trim();
  if (shellPwd && isAbsolute(shellPwd) && isUsableLaunchPath(shellPwd)) return shellPwd;

  return process.cwd();
}

function resolveOutputPath(pathArg: string): string {
  const trimmed = pathArg.trim();
  if (isAbsolute(trimmed) || isHomeRelativePath(trimmed)) {
    return resolveCustomPlanDirPath(trimmed);
  }
  return resolve(resolveLaunchCwd(), trimmed);
}

function outArgLooksLikeDirectory(outArg: string): boolean {
  return outArg.endsWith('/') || outArg.endsWith('\\');
}

async function inferFormatFromOutArg(
  outArg: string | undefined,
  statFn: typeof stat,
): Promise<PlanDownloadFormat | 'pdf' | undefined> {
  if (!outArg || outArg === '-') return undefined;
  if (outArgLooksLikeDirectory(outArg)) return undefined;

  const target = resolveOutputPath(outArg);
  try {
    const info = await statFn(target);
    if (info.isDirectory()) return undefined;
  } catch {
    // Path does not exist yet; infer from the requested file name.
  }
  return inferPlanDownloadFormat(outArg);
}

async function resolveDestinationFile(
  outArg: string | undefined,
  filename: string,
  deps: Required<Pick<DownloadDeps, 'stat'>>,
): Promise<string> {
  if (!outArg || outArg === '-') return resolve(resolveLaunchCwd(), filename);

  const target = resolveOutputPath(outArg);
  if (outArgLooksLikeDirectory(outArg)) return resolve(target, filename);
  try {
    const info = await deps.stat(target);
    if (info.isDirectory()) return resolve(target, filename);
  } catch {
    // Path does not exist yet; treat it as a file path.
  }
  return target;
}

function formatQuickSelectList(matches: CloudPlanDownloadMatch[]): string[] {
  return matches.flatMap((match, index) => [
    `  ${formatPlanDownloadChoice(match, index + 1)}`,
    formatPlanDownloadRetry(match),
  ]);
}

function formatAmbiguousMatches(matches: CloudPlanDownloadMatch[]): string {
  if (matches.length === 0) {
    return '[agendex] multiple plans matched; pick a number or retry with a plan id';
  }
  return [
    '[agendex] multiple plans matched — pick one without retyping the title:',
    ...formatQuickSelectList(matches),
  ].join('\n');
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

function isAlreadyExistsError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'EEXIST';
}

async function pathExists(path: string, statFn: typeof stat): Promise<boolean> {
  try {
    await statFn(path);
    return true;
  } catch {
    return false;
  }
}

async function writeDownloadedPlan(
  plan: CloudPlanDownload,
  format: PlanDownloadFormat,
  outArg: string | undefined,
  force: boolean,
  deps: {
    log: (message: string) => void;
    error: (message: string) => void;
    writeStdout: (content: string) => void;
    writeFile: (path: string, content: string) => Promise<void>;
    mkdir: (path: string) => Promise<void>;
    stat: typeof stat;
  },
): Promise<number> {
  const filename = createPlanDownloadFilename(plan, format);
  const content = renderPlanDownload(plan, format);

  if (outArg === '-') {
    deps.writeStdout(content);
    return 0;
  }

  const destination = await resolveDestinationFile(outArg, filename, { stat: deps.stat });
  if (!force && (await pathExists(destination, deps.stat))) {
    deps.error(`[agendex] ${destination} already exists. Use --force to overwrite.`);
    return 1;
  }

  try {
    await deps.mkdir(dirname(destination));
    await deps.writeFile(destination, content);
  } catch (err) {
    if (isAlreadyExistsError(err)) {
      deps.error(`[agendex] ${destination} already exists. Use --force to overwrite.`);
      return 1;
    }
    deps.error(
      `[agendex] could not write file: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }

  deps.log(
    `[agendex] downloaded "${sanitizeTerminalText(plan.title)}" (${sanitizeTerminalText(plan.agent)})`,
  );
  deps.log(`[agendex] ${destination}`);
  return 0;
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

  const { query, agent } = resolveQueryAndAgent(positionalArgs(args), agentFlag.value);
  if (!query) {
    error(`[agendex] usage: ${USAGE}`);
    return 1;
  }

  let format: PlanDownloadFormat = 'md';
  const inferred = await inferFormatFromOutArg(outFlag.value, statFn);
  if (formatFlag.value) {
    const parsed = parsePlanDownloadFormat(formatFlag.value);
    if (parsed === 'invalid') {
      error('[agendex] --format must be md or html');
      return 1;
    }
    if (parsed === 'pdf') {
      error('[agendex] PDF download is available in the web app; CLI supports md and html');
      return 1;
    }
    format = parsed;
  } else if (inferred === 'pdf') {
    error('[agendex] PDF download is available in the web app; CLI supports md and html');
    return 1;
  } else if (inferred) {
    format = inferred;
  }

  const config = loadConfig();
  if (!config?.cloudToken || !config?.convexUrl) {
    error('[agendex] not logged in. Run `agendex login` first.');
    return 1;
  }

  let result: FetchCloudPlanResult;
  try {
    result = await fetchCloudPlanFn(query, agent);
  } catch (err) {
    error(`[agendex] download failed: ${err instanceof Error ? err.message : String(err)}`);
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
        : formatAmbiguousMatches(result.matches),
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

  return writeDownloadedPlan(result.plan, format, outFlag.value, force, {
    log,
    error,
    writeStdout,
    writeFile: writeFileFn,
    mkdir: mkdirFn,
    stat: statFn,
  });
}
