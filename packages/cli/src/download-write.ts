import { dirname, isAbsolute, resolve } from 'node:path';
import { isHomeRelativePath, resolveCustomPlanDirPath } from '@agendex/shared';
import type { CloudPlanDownload } from './api.ts';
import {
  type PlanDownloadFormat,
  createPlanDownloadFilename,
  inferPlanDownloadFormat,
  parsePlanDownloadFormat,
  renderPlanDownload,
} from './download-format.ts';
import { sanitizeTerminalText } from './download-prompt.ts';

export interface WriteDownloadedPlanDeps {
  log: (message: string) => void;
  error: (message: string) => void;
  writeStdout: (content: string) => void;
  writeFile: (path: string, content: string) => Promise<void>;
  mkdir: (path: string) => Promise<void>;
  stat: (path: string) => Promise<{ isDirectory: () => boolean }>;
}

export type WriteDownloadedPlanResult = { ok: true; destination: string | null } | { ok: false };

export function isUsableLaunchPath(pathArg: string, platform = process.platform): boolean {
  if (platform !== 'win32') return true;
  return /^[A-Za-z]:[\\/]/.test(pathArg) || pathArg.startsWith('\\\\');
}

export function resolveLaunchCwd(): string {
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

export async function inferFormatFromOutArg(
  outArg: string | undefined,
  statFn: WriteDownloadedPlanDeps['stat'],
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

export async function resolveDownloadFormat(options: {
  formatFlag?: string;
  outArg?: string;
  stat: WriteDownloadedPlanDeps['stat'];
}): Promise<{ kind: 'ok'; format: PlanDownloadFormat } | { kind: 'error'; message: string }> {
  const inferred = await inferFormatFromOutArg(options.outArg, options.stat);
  if (options.formatFlag) {
    const parsed = parsePlanDownloadFormat(options.formatFlag);
    if (parsed === 'invalid') {
      return { kind: 'error', message: '[agendex] --format must be md or html' };
    }
    if (parsed === 'pdf') {
      return {
        kind: 'error',
        message: '[agendex] PDF download is available in the web app; CLI supports md and html',
      };
    }
    return { kind: 'ok', format: parsed };
  }
  if (inferred === 'pdf') {
    return {
      kind: 'error',
      message: '[agendex] PDF download is available in the web app; CLI supports md and html',
    };
  }
  return { kind: 'ok', format: inferred ?? 'md' };
}

async function resolveDestinationFile(
  outArg: string | undefined,
  filename: string,
  statFn: WriteDownloadedPlanDeps['stat'],
): Promise<string> {
  if (!outArg || outArg === '-') return resolve(resolveLaunchCwd(), filename);

  const target = resolveOutputPath(outArg);
  if (outArgLooksLikeDirectory(outArg)) return resolve(target, filename);
  try {
    const info = await statFn(target);
    if (info.isDirectory()) return resolve(target, filename);
  } catch {
    // Path does not exist yet; treat it as a file path.
  }
  return target;
}

function isAlreadyExistsError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'EEXIST';
}

async function pathExists(path: string, statFn: WriteDownloadedPlanDeps['stat']): Promise<boolean> {
  try {
    await statFn(path);
    return true;
  } catch {
    return false;
  }
}

export async function writeDownloadedPlan(
  plan: CloudPlanDownload,
  format: PlanDownloadFormat,
  outArg: string | undefined,
  force: boolean,
  deps: WriteDownloadedPlanDeps,
): Promise<WriteDownloadedPlanResult> {
  const filename = createPlanDownloadFilename(plan, format);
  const content = renderPlanDownload(plan, format);

  if (outArg === '-') {
    deps.writeStdout(content);
    return { ok: true, destination: null };
  }

  const destination = await resolveDestinationFile(outArg, filename, deps.stat);
  if (!force && (await pathExists(destination, deps.stat))) {
    deps.error(`[agendex] ${destination} already exists. Use --force to overwrite.`);
    return { ok: false };
  }

  try {
    await deps.mkdir(dirname(destination));
    await deps.writeFile(destination, content);
  } catch (err) {
    if (isAlreadyExistsError(err)) {
      deps.error(`[agendex] ${destination} already exists. Use --force to overwrite.`);
      return { ok: false };
    }
    deps.error(
      `[agendex] could not write file: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { ok: false };
  }

  deps.log(
    `[agendex] downloaded "${sanitizeTerminalText(plan.title)}" (${sanitizeTerminalText(plan.agent)})`,
  );
  deps.log(`[agendex] ${sanitizeTerminalText(destination)}`);
  return { ok: true, destination };
}
