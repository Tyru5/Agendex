import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import type { AgentAdapter } from '../types.ts';
import { createMarkdownArtifactAdapter, createMarkdownBundleAdapter } from './markdown-artifact.ts';

function runtimeHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

function normalizePath(path: string): string {
  return resolve(path).replaceAll('\\', '/');
}

function isWithin(filePath: string, directory: string): boolean {
  const file = normalizePath(filePath);
  const root = normalizePath(directory);
  return file === root || file.startsWith(`${root}/`);
}

function workspaceBeforeMarker(filePath: string, marker: string): string | undefined {
  const normalized = normalizePath(filePath);
  const index = normalized.toLowerCase().lastIndexOf(`/${marker.toLowerCase()}/`);
  return index > 0 ? normalized.slice(0, index) : undefined;
}

function envPlanDirs(name: string): string[] {
  const value = process.env[name]?.trim();
  if (!value) return [];
  return value
    .split(delimiter)
    .map((path) => path.trim())
    .filter(Boolean)
    .map((path) =>
      resolve(path === '~' ? runtimeHomeDir() : path.replace(/^~(?=[/\\])/, runtimeHomeDir())),
    );
}

function unique(paths: string[]): string[] {
  return Array.from(new Set(paths.map((path) => resolve(path))));
}

/**
 * Match Markdown plans under configured roots or the concrete project marker root
 * currently being scanned. Candidate paths cannot declare their own marker roots.
 */
function markdownInConfiguredRoot(
  filePath: string,
  getRoots: () => string[],
  marker?: string,
  scanRoot?: string,
): boolean {
  if (!filePath.toLowerCase().endsWith('.md')) return false;

  const roots = [...getRoots()];
  if (marker && scanRoot) {
    const normalized = normalizePath(filePath);
    const needle = `/${marker.replaceAll('\\', '/')}/`;
    const index = normalized.toLowerCase().lastIndexOf(needle.toLowerCase());
    if (index >= 0) {
      const markerRoot = normalized.slice(0, index + needle.length - 1);
      if (normalizePath(scanRoot) === markerRoot) roots.push(markerRoot);
    }
  }
  return roots.some((root) => isWithin(filePath, root));
}

function readJson(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function nestedString(
  value: Record<string, unknown> | undefined,
  keys: string[],
): string | undefined {
  let current: unknown = value;
  for (const key of keys) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' && current.trim() ? current.trim() : undefined;
}

function configuredProjectDirectory(
  settingsRelativePath: string,
  settingKeys: string[],
): string | undefined {
  let directory = resolve(process.cwd());
  const home = resolve(runtimeHomeDir());
  while (true) {
    if (directory === home) return undefined;
    const settingsPath = join(directory, settingsRelativePath);
    const configured = nestedString(readJson(settingsPath), settingKeys);
    if (configured) return resolve(directory, configured.replace(/^~(?=[/\\])/, runtimeHomeDir()));
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function currentProjectRoot(): string {
  let directory = resolve(process.cwd());
  while (true) {
    if (existsSync(join(directory, '.git'))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return resolve(process.cwd());
    directory = parent;
  }
}

function resolveProjectSetting(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const expanded = value.replace(/^~(?=[/\\])/, runtimeHomeDir());
  return resolve(isAbsolute(expanded) ? expanded : join(currentProjectRoot(), expanded));
}

function simpleProjectAdapter(options: {
  agent: string;
  marker: string;
  env: string;
  roots?: () => string[];
  writable?: boolean;
}): AgentAdapter {
  const getSearchPaths = () => unique([...(options.roots?.() ?? []), ...envPlanDirs(options.env)]);
  return createMarkdownArtifactAdapter({
    agent: options.agent,
    writable: options.writable,
    getSearchPaths,
    matches: (filePath, scanRoot) =>
      markdownInConfiguredRoot(filePath, getSearchPaths, options.marker, scanRoot),
    workspace: ({ filePath }) => workspaceBeforeMarker(filePath, options.marker),
    metadata: ({ filePath }) => ({
      artifactRoot: getSearchPaths().find((root) => isWithin(filePath, root)),
    }),
  });
}

function antigravityRoots(): string[] {
  const home = runtimeHomeDir();
  return unique([
    join(home, '.gemini', 'antigravity', 'brain'),
    join(home, '.gemini', 'antigravity-cli', 'brain'),
    ...envPlanDirs('AGENDEX_ANTIGRAVITY_PLAN_DIRS'),
  ]);
}

export const antigravityAdapter = createMarkdownArtifactAdapter({
  agent: 'antigravity',
  getSearchPaths: antigravityRoots,
  matches(filePath) {
    const filename = basename(filePath).toLowerCase();
    if (filename !== 'implementation_plan.md' && filename !== 'implementation-plan.md')
      return false;
    return antigravityRoots().some((root) => isWithin(filePath, root));
  },
  workspace: ({ filePath }) => workspaceBeforeMarker(filePath, '.gemini/antigravity'),
  metadata: ({ filePath }) => ({
    conversationId: basename(dirname(filePath)),
    artifactType: 'implementation-plan',
  }),
});

export const codeBuddyAdapter = simpleProjectAdapter({
  agent: 'codebuddy',
  marker: '.codebuddy/plans',
  env: 'AGENDEX_CODEBUDDY_PLAN_DIRS',
  writable: true,
});

export const droidAdapter = simpleProjectAdapter({
  agent: 'droid',
  marker: '.factory/docs',
  env: 'AGENDEX_DROID_PLAN_DIRS',
  roots: () => [join(runtimeHomeDir(), '.factory', 'docs')],
  writable: true,
});

function geminiRoots(): string[] {
  const home = runtimeHomeDir();
  const projectConfigured = configuredProjectDirectory('.gemini/settings.json', [
    'general',
    'plan',
    'directory',
  ]);
  const userConfigured = resolveProjectSetting(
    nestedString(readJson(join(home, '.gemini', 'settings.json')), [
      'general',
      'plan',
      'directory',
    ]),
  );
  return unique([
    join(home, '.gemini', 'tmp'),
    ...(projectConfigured ? [projectConfigured] : []),
    ...(userConfigured ? [userConfigured] : []),
    ...envPlanDirs('AGENDEX_GEMINI_CLI_PLAN_DIRS'),
  ]);
}

export const geminiCliAdapter = createMarkdownArtifactAdapter({
  agent: 'gemini-cli',
  writable: true,
  getSearchPaths: geminiRoots,
  matches: (filePath, scanRoot) =>
    markdownInConfiguredRoot(filePath, geminiRoots, '.gemini/plans', scanRoot),
  workspace: ({ filePath }) => workspaceBeforeMarker(filePath, '.gemini/plans'),
  metadata: ({ filePath }) => ({
    sessionId: normalizePath(filePath).match(/\/\.gemini\/tmp\/[^/]+\/([^/]+)\/plans\//i)?.[1],
  }),
});

function copilotRoots(): string[] {
  const home = process.env.COPILOT_HOME?.trim() || join(runtimeHomeDir(), '.copilot');
  return unique([join(home, 'session-state'), ...envPlanDirs('AGENDEX_GITHUB_COPILOT_PLAN_DIRS')]);
}

export const githubCopilotAdapter = createMarkdownArtifactAdapter({
  agent: 'copilot-chat',
  writable: true,
  getSearchPaths: copilotRoots,
  matches: (filePath) =>
    basename(filePath).toLowerCase() === 'plan.md' &&
    copilotRoots().some((root) => isWithin(filePath, root)),
  metadata: ({ filePath }) => ({
    sessionId: basename(dirname(filePath)),
  }),
});

export const junieAdapter = simpleProjectAdapter({
  agent: 'junie',
  marker: '.junie/plans',
  env: 'AGENDEX_JUNIE_PLAN_DIRS',
  writable: true,
});

export const kiloAdapter = simpleProjectAdapter({
  agent: 'kilo-cli',
  marker: '.kilo/plans',
  env: 'AGENDEX_KILO_PLAN_DIRS',
  writable: true,
});

function kimiRoots(): string[] {
  const currentHome = process.env.KIMI_CODE_HOME?.trim() || join(runtimeHomeDir(), '.kimi-code');
  const legacyHome = process.env.KIMI_SHARE_DIR?.trim() || join(runtimeHomeDir(), '.kimi');
  return unique([
    join(currentHome, 'sessions'),
    join(legacyHome, 'plans'),
    ...envPlanDirs('AGENDEX_KIMI_CODE_PLAN_DIRS'),
  ]);
}

export const kimiCodeAdapter = createMarkdownArtifactAdapter({
  agent: 'kimi-cli',
  writable: true,
  getSearchPaths: kimiRoots,
  matches(filePath) {
    if (!filePath.toLowerCase().endsWith('.md')) return false;
    const normalized = normalizePath(filePath).toLowerCase();
    return (
      (normalized.includes('/agents/main/plans/') &&
        kimiRoots().some((root) => isWithin(filePath, root))) ||
      kimiRoots().some(
        (root) => isWithin(filePath, root) && normalizePath(root).toLowerCase().endsWith('/plans'),
      )
    );
  },
  metadata: ({ filePath }) => ({
    sessionId: normalizePath(filePath).match(
      /\/sessions\/[^/]+\/([^/]+)\/agents\/main\/plans\//i,
    )?.[1],
  }),
});

const KIRO_DOCUMENTS = [
  { filenames: ['requirements.md', 'bugfix.md'], heading: 'Requirements' },
  { filenames: ['design.md'], heading: 'Design' },
  { filenames: ['tasks.md'], heading: 'Tasks' },
];

function kiroRoots(): string[] {
  return envPlanDirs('AGENDEX_KIRO_PLAN_DIRS');
}

export const kiroAdapter = createMarkdownBundleAdapter({
  agent: 'kiro-cli',
  getSearchPaths: kiroRoots,
  matches(filePath, scanRoot) {
    const filename = basename(filePath).toLowerCase();
    return (
      KIRO_DOCUMENTS.some((document) => document.filenames.includes(filename)) &&
      markdownInConfiguredRoot(filePath, kiroRoots, '.kiro/specs', scanRoot)
    );
  },
  getBundleDir: dirname,
  documents: KIRO_DOCUMENTS,
  title: ({ bundleDir }) =>
    basename(bundleDir)
      .split(/[-_]+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' '),
  workspace: ({ bundleDir }) => workspaceBeforeMarker(`${bundleDir}${sep}tasks.md`, '.kiro/specs'),
  metadata: ({ bundleDir }) => ({ specName: basename(bundleDir) }),
});

function muxRoots(): string[] {
  return unique([join(runtimeHomeDir(), '.mux', 'plans'), ...envPlanDirs('AGENDEX_MUX_PLAN_DIRS')]);
}

export const muxAdapter = createMarkdownArtifactAdapter({
  agent: 'mux',
  writable: true,
  getSearchPaths: muxRoots,
  matches: (filePath) => markdownInConfiguredRoot(filePath, muxRoots),
  metadata: ({ filePath }) => {
    const root = muxRoots().find((candidate) => isWithin(filePath, candidate));
    const relative = root ? normalizePath(filePath).slice(normalizePath(root).length + 1) : '';
    const [project] = relative.split('/');
    return { project, workspaceName: basename(filePath, '.md') };
  },
});

function qwenRoots(): string[] {
  const home = runtimeHomeDir();
  const projectConfigured = configuredProjectDirectory('.qwen/settings.json', ['plansDirectory']);
  const userSettings = readJson(join(home, '.qwen', 'settings.json'));
  const userConfigured = resolveProjectSetting(nestedString(userSettings, ['plansDirectory']));
  return unique([
    join(home, '.qwen', 'plans'),
    ...(projectConfigured ? [projectConfigured] : []),
    ...(userConfigured ? [userConfigured] : []),
    ...envPlanDirs('AGENDEX_QWEN_CODE_PLAN_DIRS'),
  ]);
}

export const qwenCodeAdapter = createMarkdownArtifactAdapter({
  agent: 'qwen-code',
  writable: true,
  getSearchPaths: qwenRoots,
  matches: (filePath, scanRoot) =>
    markdownInConfiguredRoot(filePath, qwenRoots, '.qwen/plans', scanRoot),
  workspace: ({ filePath }) => workspaceBeforeMarker(filePath, '.qwen/plans'),
});

function windsurfRoots(): string[] {
  return unique([
    join(runtimeHomeDir(), '.windsurf', 'plans'),
    ...envPlanDirs('AGENDEX_WINDSURF_PLAN_DIRS'),
  ]);
}

export const windsurfAdapter = createMarkdownArtifactAdapter({
  agent: 'windsurf',
  writable: true,
  getSearchPaths: windsurfRoots,
  matches: (filePath) => markdownInConfiguredRoot(filePath, windsurfRoots),
  metadata: () => ({ product: 'Devin Desktop / Windsurf' }),
});
