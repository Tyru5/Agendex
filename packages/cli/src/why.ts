import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  getDefaultAdapterIds,
  getFilePlanHistory,
  loadConfig,
  resolveAdapters,
  scan,
  setActiveAdapters,
} from '@agendex/shared';
import {
  FILE_PLAN_HISTORY_DEFAULT_LIMIT,
  FILE_PLAN_HISTORY_MAX_LIMIT,
  type FilePlanHistory,
} from '@agendex/shared/file-plan-history';
import { resolveCliAdapterIds } from './adapters.ts';
import { sanitizeTerminalText } from './download-prompt.ts';
import { writeStderr, writeStdout } from './stdio.ts';

const USAGE = 'agendex why <file> [--workspace <dir>] [--limit <1-100>] [--json]';

export interface WhyOptions {
  path: string;
  workspace?: string;
  limit: number;
  json: boolean;
}

export function parseWhyArgs(args: string[]): WhyOptions {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      workspace: { type: 'string' },
      limit: { type: 'string' },
      json: { type: 'boolean' },
      dev: { type: 'boolean' },
    },
  });
  const path = positionals[0]?.trim();
  if (positionals.length !== 1 || !path || path.includes('\0') || path.length > 4096) {
    throw new Error('Provide one file path. Quote paths containing spaces.');
  }
  if (values.workspace !== undefined && !values.workspace.trim()) {
    throw new Error('--workspace must be an existing directory.');
  }
  const limit = values.limit === undefined ? FILE_PLAN_HISTORY_DEFAULT_LIMIT : Number(values.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > FILE_PLAN_HISTORY_MAX_LIMIT) {
    throw new Error(`--limit must be an integer from 1 to ${FILE_PLAN_HISTORY_MAX_LIMIT}.`);
  }
  return { path, workspace: values.workspace, limit, json: values.json ?? false };
}

export function renderFilePlanHistory(history: FilePlanHistory): string {
  const clean = sanitizeTerminalText;
  const lines = [`Plans for ${clean(history.path)}`, `Workspace: ${clean(history.workspace)}`, ''];
  if (history.total === 0) {
    lines.push('No indexed plans mention this file or have attributed commits that changed it.');
    return lines.join('\n');
  }
  for (const plan of history.plans) {
    const evidence = [
      ...(plan.mentioned ? ['mentioned in plan'] : []),
      ...(plan.changedByPlanCommits ? ['changed by attributed commits'] : []),
    ];
    lines.push(`${clean(plan.title)} (${clean(plan.agent)})`);
    lines.push(
      `  ${plan.id} | ${plan.createdAt.slice(0, 10)} | ${plan.receipt?.status ?? 'unavailable'}`,
    );
    lines.push(`  ${evidence.join('; ')}`);
    if (plan.receipt?.confidence)
      lines.push(`  Attribution confidence: ${plan.receipt.confidence}`);
    lines.push(`  Plan: ${clean(plan.filePath)}`, '');
  }
  lines.push(`Showing ${history.plans.length} of ${history.total} matching plans, newest first.`);
  return lines.join('\n');
}

async function initializeLocalIndex(): Promise<void> {
  const config = loadConfig();
  setActiveAdapters(
    resolveAdapters(config ? resolveCliAdapterIds(config) : getDefaultAdapterIds()),
  );
  // Keep machine-readable stdout clean while the scanner reports its progress.
  const previous = { log: console.log, info: console.info, debug: console.debug };
  console.log = console.info = console.debug = (...args: unknown[]) => console.error(...args);
  try {
    await scan();
  } finally {
    Object.assign(console, previous);
  }
}

export async function runWhyCommand(
  args: string[],
  dependencies = {
    initialize: initializeLocalIndex,
    lookup: getFilePlanHistory,
    stdout: writeStdout,
    stderr: writeStderr,
  },
): Promise<number> {
  let options: WhyOptions;
  try {
    options = parseWhyArgs(args);
  } catch (error) {
    dependencies.stderr(
      `[agendex] ${error instanceof Error ? error.message : 'Invalid arguments.'}`,
    );
    dependencies.stderr(`[agendex] usage: ${USAGE}`);
    return 1;
  }
  const previousCwd = process.cwd();
  try {
    if (options.workspace) process.chdir(resolve(options.workspace));
    await dependencies.initialize();
    const history = await dependencies.lookup(options.path, {
      cwd: process.cwd(),
      limit: options.limit,
    });
    dependencies.stdout(options.json ? JSON.stringify(history) : renderFilePlanHistory(history));
    return 0;
  } catch (error) {
    dependencies.stderr(
      `[agendex] ${sanitizeTerminalText(error instanceof Error ? error.message : 'File lookup failed.')}`,
    );
    return 1;
  } finally {
    if (process.cwd() !== previousCwd) process.chdir(previousCwd);
  }
}
