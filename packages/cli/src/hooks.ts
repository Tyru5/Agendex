import { isDevMode } from '@agendex/shared';
import { runReviewPlan } from './review-plan.ts';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export type HookAgent = 'claude-code' | 'codex' | 'pi';
export type HookScope = 'user' | 'repo';

const SUPPORTED_AGENTS: HookAgent[] = ['claude-code', 'codex', 'pi'];
const MANAGED_MARKER = 'agendex-plan-review';
const HOOK_TIMEOUT_SECONDS = 3610;
const PREVIEW_FLAG = '--preview';

interface HookStatusRow {
  agent: HookAgent;
  installed: boolean;
  path: string;
  detail: string;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function commandFor(cliEntry: string, agent: HookAgent): string {
  return `${shellQuote(process.execPath)} ${shellQuote(cliEntry)}${isDevMode() ? ' --dev' : ''} review-plan --hook --agent ${agent}`;
}

function scopeRoot(scope: HookScope): string {
  return scope === 'repo' ? resolve(process.env.PWD || process.cwd()) : homedir();
}

function hooksJsonPath(agent: HookAgent, scope: HookScope): string {
  const root = scopeRoot(scope);
  if (agent === 'claude-code') return join(root, '.claude', 'settings.json');
  if (agent === 'codex') return join(root, '.codex', 'hooks.json');
  return join(
    root,
    scope === 'repo' ? '.pi/extensions/agendex/index.ts' : '.pi/agent/extensions/agendex/index.ts',
  );
}

function codexConfigPath(scope: HookScope): string {
  return join(scopeRoot(scope), '.codex', 'config.toml');
}

function readJsonFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Could not parse ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function backupPathFor(path: string): string {
  return `${path}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

async function writeWithBackup(path: string, content: string, dryRun: boolean): Promise<void> {
  if (dryRun) return;
  await mkdir(dirname(path), { recursive: true });
  if (existsSync(path)) {
    await writeFile(backupPathFor(path), readFileSync(path, 'utf-8'), 'utf-8');
  }
  await writeFile(path, content, 'utf-8');
}

async function removeWithBackup(path: string, dryRun: boolean): Promise<void> {
  if (dryRun || !existsSync(path)) return;
  await writeFile(backupPathFor(path), readFileSync(path, 'utf-8'), 'utf-8');
  await rm(path);
}

function mergeCommandHook({
  config,
  event,
  matcher,
  command,
}: {
  config: Record<string, unknown>;
  event: string;
  matcher?: string;
  command: string;
}): Record<string, unknown> {
  const hooks = isRecord(config.hooks) ? { ...config.hooks } : {};
  const existingEvent = Array.isArray(hooks[event]) ? [...hooks[event]] : [];

  const entry = {
    ...(matcher ? { matcher } : {}),
    id: MANAGED_MARKER,
    hooks: [
      {
        type: 'command',
        command,
        timeout: HOOK_TIMEOUT_SECONDS,
      },
    ],
  };

  const index = existingEvent.findIndex((item) => {
    if (!isRecord(item)) return false;
    if (item.id === MANAGED_MARKER) return true;
    return JSON.stringify(item).includes('agendex') && JSON.stringify(item).includes('review-plan');
  });

  if (index >= 0) existingEvent[index] = entry;
  else existingEvent.push(entry);

  hooks[event] = existingEvent;
  return { ...config, hooks };
}

function hasManagedHook(path: string): boolean {
  if (!existsSync(path)) return false;
  const raw = readFileSync(path, 'utf-8');
  return raw.includes(MANAGED_MARKER) || (raw.includes('agendex') && raw.includes('review-plan'));
}

function isManagedHookEntry(item: unknown): boolean {
  if (!isRecord(item)) return false;
  if (item.id === MANAGED_MARKER) return true;
  const serialized = JSON.stringify(item);
  return serialized.includes('agendex') && serialized.includes('review-plan');
}

function removeManagedHooks(config: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(config.hooks)) return config;

  const hooks: Record<string, unknown> = {};
  for (const [event, value] of Object.entries(config.hooks)) {
    if (!Array.isArray(value)) {
      hooks[event] = value;
      continue;
    }

    const kept = value.filter((item) => !isManagedHookEntry(item));
    if (kept.length > 0) hooks[event] = kept;
  }

  return Object.keys(hooks).length > 0 ? { ...config, hooks } : { ...config, hooks: {} };
}

function ensureCodexHooksEnabled(raw: string): string {
  const lines = raw ? raw.split('\n') : [];
  const featuresIndex = lines.findIndex((line) => /^\s*\[features\]\s*$/.test(line));
  if (featuresIndex === -1) {
    return `${raw.trimEnd()}\n\n[features]\nhooks = true\n`;
  }

  let insertAt = lines.length;
  for (let i = featuresIndex + 1; i < lines.length; i++) {
    if (/^\s*\[.+\]\s*$/.test(lines[i] ?? '')) {
      insertAt = i;
      break;
    }
    if (/^\s*hooks\s*=/.test(lines[i] ?? '')) {
      lines[i] = 'hooks = true';
      return `${lines.join('\n').trimEnd()}\n`;
    }
  }

  lines.splice(insertAt, 0, 'hooks = true');
  return `${lines.join('\n').trimEnd()}\n`;
}

type PreviewAgent = 'codex';
const PREVIEW_EFFECT: Record<PreviewAgent, { refusal: string; dryRun: string; installed: string }> =
  {
    codex: {
      refusal: 'codex: Stop cannot approve or reject a plan permission request.',
      dryRun:
        'This legacy Stop hook is unsupported for plan approval; the review command will fail without sending a continuation decision.',
      installed:
        'The legacy Stop hook is unsupported for plan approval. Uninstall it; use review-plan --file for manual review.',
    },
  };

function isPreviewAgent(agent: HookAgent): agent is PreviewAgent {
  return agent in PREVIEW_EFFECT;
}

function printPreviewBlock(agents: PreviewAgent[]): void {
  console.error(
    `[agendex] refusing to install ${agents.join(' and ')} ${agents.length === 1 ? 'hook' : 'hooks'}: Codex Stop does not provide a plan-permission contract.`,
  );
  for (const agent of agents) console.error(`[agendex] ${PREVIEW_EFFECT[agent].refusal}`);
  console.error(
    `[agendex] Re-run with ${PREVIEW_FLAG} to opt in deliberately, or install pi separately.`,
  );
}

function printPreviewWarning(agent: PreviewAgent, dryRun: boolean): void {
  console.error(`[agendex] WARNING: ${agent} hook support is preview-only.`);
  console.error(
    `[agendex] ${dryRun ? PREVIEW_EFFECT[agent].dryRun : PREVIEW_EFFECT[agent].installed}`,
  );
  console.error(`[agendex] Remove it with: agendex hooks uninstall ${agent}`);
}

function previewDetail(agent: HookAgent, detail: string): string {
  return isPreviewAgent(agent)
    ? `${detail}; preview-only; unsupported for plan permission, remove with: agendex hooks uninstall ${agent}`
    : detail;
}

async function installClaude(scope: HookScope, cliEntry: string, dryRun: boolean): Promise<string> {
  const path = hooksJsonPath('claude-code', scope);
  const config = mergeCommandHook({
    config: readJsonFile(path),
    event: 'PermissionRequest',
    matcher: 'ExitPlanMode',
    command: commandFor(cliEntry, 'claude-code'),
  });
  await writeWithBackup(path, `${JSON.stringify(config, null, 2)}\n`, dryRun);
  return path;
}

async function installCodex(scope: HookScope, cliEntry: string, dryRun: boolean): Promise<string> {
  const configPath = codexConfigPath(scope);
  const config = existsSync(configPath) ? readFileSync(configPath, 'utf-8') : '';
  await writeWithBackup(configPath, ensureCodexHooksEnabled(config), dryRun);

  const hooksPath = hooksJsonPath('codex', scope);
  const hookConfig = mergeCommandHook({
    config: readJsonFile(hooksPath),
    event: 'Stop',
    command: commandFor(cliEntry, 'codex'),
  });
  await writeWithBackup(hooksPath, `${JSON.stringify(hookConfig, null, 2)}\n`, dryRun);
  return hooksPath;
}

function piExtensionSource(cliEntry: string): string {
  const command = commandFor(cliEntry, 'pi');
  return `import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const REVIEW_COMMAND = ${JSON.stringify(command)};

export default function agendexPiExtension(pi: ExtensionAPI): void {
  pi.registerCommand('agendex-review-plan', {
    description: 'Show the Agendex manual plan review command (not an automatic Pi gate)',
    handler: async (_args, ctx) => {
      ctx.ui.notify('Agendex review command registered. Use agendex review-plan --file /absolute/path/to/plan.md for manual review; Pi has no automatic permission gate.', 'info');
      pi.sendMessage(
        {
          customType: 'agendex-review-command',
          content: '[Agendex] Run this hook command from a shell-integrated Pi workflow when you need hook-native review JSON:\n' + REVIEW_COMMAND,
          display: true,
        },
        { triggerTurn: false },
      );
    },
  });

  pi.registerCommand('agendex-annotate', {
    description: 'Record Agendex annotation feedback in the active Pi session',
    handler: async (args, ctx) => {
      const feedback = args?.trim();
      if (!feedback) {
        ctx.ui.notify('Usage: /agendex-annotate <feedback>', 'warning');
        return;
      }
      pi.sendMessage(
        {
          customType: 'agendex-annotation-feedback',
          content: '[Agendex annotation feedback]\n' + feedback,
          display: true,
        },
        { triggerTurn: true },
      );
    },
  });

  pi.on('session_start', async (_event, ctx) => {
    ctx.ui.setStatus('agendex', 'agendex hooks');
  });
}
`;
}

async function installPi(scope: HookScope, cliEntry: string, dryRun: boolean): Promise<string> {
  const path = hooksJsonPath('pi', scope);
  await writeWithBackup(path, piExtensionSource(cliEntry), dryRun);
  return path;
}

async function installAgent(agent: HookAgent, scope: HookScope, cliEntry: string, dryRun: boolean) {
  if (agent === 'claude-code') return await installClaude(scope, cliEntry, dryRun);
  if (agent === 'codex') return await installCodex(scope, cliEntry, dryRun);
  return await installPi(scope, cliEntry, dryRun);
}

async function uninstallJsonAgent(
  agent: 'claude-code' | 'codex',
  scope: HookScope,
  dryRun: boolean,
) {
  const path = hooksJsonPath(agent, scope);
  const paths =
    agent === 'claude-code' ? [path, join(scopeRoot(scope), '.claude', 'hooks.json')] : [path];
  for (const target of paths) {
    if (!existsSync(target)) continue;
    const updated = removeManagedHooks(readJsonFile(target));
    await writeWithBackup(target, `${JSON.stringify(updated, null, 2)}\n`, dryRun);
  }
  return path;
}

async function uninstallPi(scope: HookScope, dryRun: boolean) {
  const path = hooksJsonPath('pi', scope);
  if (hasManagedHook(path)) await removeWithBackup(path, dryRun);
  return path;
}

async function uninstallAgent(agent: HookAgent, scope: HookScope, dryRun: boolean) {
  if (agent === 'claude-code' || agent === 'codex')
    return await uninstallJsonAgent(agent, scope, dryRun);
  return await uninstallPi(scope, dryRun);
}

function statusFor(agent: HookAgent, scope: HookScope): HookStatusRow {
  const path = hooksJsonPath(agent, scope);
  if (agent === 'codex') {
    const configPath = codexConfigPath(scope);
    const configEnabled =
      existsSync(configPath) && /hooks\s*=\s*true/.test(readFileSync(configPath, 'utf-8'));
    const installed = configEnabled && hasManagedHook(path);
    return {
      agent,
      installed,
      path,
      detail: installed
        ? previewDetail(agent, 'Stop hook installed and hooks feature enabled')
        : 'Missing Stop hook or [features].hooks = true',
    };
  }
  const installed = hasManagedHook(path);
  return {
    agent,
    installed,
    path,
    detail: installed
      ? previewDetail(agent, 'Agendex hook installed')
      : 'Agendex hook not installed',
  };
}

function parseScope(args: string[]): HookScope {
  const scopeIndex = args.indexOf('--scope');
  const value = scopeIndex >= 0 ? args[scopeIndex + 1] : undefined;
  if (value === 'user' || value === 'repo') return value;
  return args.includes('--user') ? 'user' : 'repo';
}

function parseAgent(value: string | undefined): HookAgent | 'all' | undefined {
  if (!value) return undefined;
  if (value === 'all') return 'all';
  if (value === 'claude' || value === 'claude-code') return 'claude-code';
  if (value === 'codex') return 'codex';
  if (value === 'pi') return 'pi';
  return undefined;
}

export async function runHooksCommand(args: string[], cliEntry: string): Promise<number> {
  const subcommand = args.find(
    (arg) => arg !== 'hooks' && arg !== '--dev' && !arg.startsWith('--'),
  );
  const scope = parseScope(args);

  if (!subcommand || subcommand === 'status') {
    const rows = SUPPORTED_AGENTS.map((agent) => statusFor(agent, scope));
    for (const row of rows) {
      console.log(
        `[agendex] ${row.agent}: ${row.installed ? 'installed' : 'not installed'} (${row.detail})`,
      );
      console.log(`  ${row.path}`);
    }
    return 0;
  }

  if (subcommand === 'doctor') {
    await runHooksCommand(['hooks', 'status', '--scope', scope], cliEntry);
    console.log('[agendex] restart the target agent after installing or changing hooks.');
    return 0;
  }

  if (subcommand === 'install') {
    const agentArg = args.find(
      (arg, index) => index > args.indexOf('install') && !arg.startsWith('--') && arg !== scope,
    );
    const parsed = parseAgent(agentArg);
    if (!parsed) {
      console.error(
        `[agendex] usage: agendex hooks install <claude-code|codex|pi|all> [--scope repo|user] [--dry-run] [${PREVIEW_FLAG}]`,
      );
      return 1;
    }

    const dryRun = args.includes('--dry-run');
    const preview = args.includes(PREVIEW_FLAG);
    const agents = parsed === 'all' ? SUPPORTED_AGENTS : [parsed];
    const previewAgents = agents.filter(isPreviewAgent);
    if (!preview && previewAgents.length > 0) {
      printPreviewBlock(previewAgents);
      return 1;
    }

    for (const agent of agents) {
      if (isPreviewAgent(agent)) printPreviewWarning(agent, dryRun);
      const path = await installAgent(agent, scope, resolve(cliEntry), dryRun);
      console.log(`[agendex] ${dryRun ? 'would install' : 'installed'} ${agent} hook: ${path}`);
    }
    return 0;
  }

  if (subcommand === 'uninstall') {
    const agentArg = args.find(
      (arg, index) => index > args.indexOf('uninstall') && !arg.startsWith('--') && arg !== scope,
    );
    const parsed = parseAgent(agentArg);
    if (!parsed) {
      console.error(
        '[agendex] usage: agendex hooks uninstall <claude-code|codex|pi|all> [--scope repo|user] [--dry-run]',
      );
      return 1;
    }

    const dryRun = args.includes('--dry-run');
    const agents = parsed === 'all' ? SUPPORTED_AGENTS : [parsed];
    for (const agent of agents) {
      const path = await uninstallAgent(agent, scope, dryRun);
      console.log(`[agendex] ${dryRun ? 'would uninstall' : 'uninstalled'} ${agent} hook: ${path}`);
    }
    return 0;
  }

  console.error(`[agendex] unknown hooks command: ${subcommand}`);
  return 1;
}

export async function runHookReviewCommand(args: string[]): Promise<number> {
  return runReviewPlan(args);
}
