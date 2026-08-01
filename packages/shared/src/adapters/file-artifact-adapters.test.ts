import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  antigravityAdapter,
  codeBuddyAdapter,
  droidAdapter,
  geminiCliAdapter,
  githubCopilotAdapter,
  junieAdapter,
  kiloAdapter,
  kimiCodeAdapter,
  kiroAdapter,
  muxAdapter,
  qwenCodeAdapter,
  windsurfAdapter,
} from './file-artifact-adapters.ts';
import { ohMyOpencodeAdapter } from './oh-my-opencode.ts';

const ENV_NAMES = [
  'HOME',
  'AGENDEX_ANTIGRAVITY_PLAN_DIRS',
  'AGENDEX_CODEBUDDY_PLAN_DIRS',
  'AGENDEX_DROID_PLAN_DIRS',
  'AGENDEX_GEMINI_CLI_PLAN_DIRS',
  'AGENDEX_GITHUB_COPILOT_PLAN_DIRS',
  'AGENDEX_JUNIE_PLAN_DIRS',
  'AGENDEX_KILO_PLAN_DIRS',
  'AGENDEX_KIRO_PLAN_DIRS',
  'AGENDEX_KIMI_CODE_PLAN_DIRS',
  'AGENDEX_MUX_PLAN_DIRS',
  'AGENDEX_QWEN_CODE_PLAN_DIRS',
  'AGENDEX_WINDSURF_PLAN_DIRS',
] as const;

const originalEnv = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
let tempRoot: string | undefined;

afterEach(async () => {
  for (const name of ENV_NAMES) {
    const value = originalEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
});

async function createPlan(path: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, '# Authentication Plan\n\n- [ ] Add OAuth callback\n- [ ] Add tests\n');
}

test('documented Markdown artifact adapters parse only their plan locations', async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'agendex-artifact-adapters-'));
  const copilotRoot = join(tempRoot, 'copilot-plans');
  const antigravityRoot = join(tempRoot, 'antigravity-plans');
  const kimiRoot = join(tempRoot, 'kimi', 'plans');
  const muxRoot = join(tempRoot, 'mux-plans');
  const windsurfRoot = join(tempRoot, 'windsurf-plans');
  process.env.AGENDEX_ANTIGRAVITY_PLAN_DIRS = antigravityRoot;
  process.env.AGENDEX_GITHUB_COPILOT_PLAN_DIRS = copilotRoot;
  process.env.AGENDEX_KIMI_CODE_PLAN_DIRS = kimiRoot;
  process.env.AGENDEX_MUX_PLAN_DIRS = muxRoot;
  process.env.AGENDEX_WINDSURF_PLAN_DIRS = windsurfRoot;

  const cases = [
    [
      antigravityAdapter,
      join(antigravityRoot, 'conversation-1', 'implementation_plan.md'),
      antigravityRoot,
    ],
    [
      codeBuddyAdapter,
      join(tempRoot, 'repo', '.codebuddy', 'plans', 'auth.md'),
      join(tempRoot, 'repo', '.codebuddy', 'plans'),
    ],
    [
      droidAdapter,
      join(tempRoot, 'repo', '.factory', 'docs', '2026-07-09-auth.md'),
      join(tempRoot, 'repo', '.factory', 'docs'),
    ],
    [
      geminiCliAdapter,
      join(tempRoot, 'repo', '.gemini', 'plans', 'auth.md'),
      join(tempRoot, 'repo', '.gemini', 'plans'),
    ],
    [githubCopilotAdapter, join(copilotRoot, 'session-1', 'plan.md'), copilotRoot],
    [
      junieAdapter,
      join(tempRoot, 'repo', '.junie', 'plans', 'auth.md'),
      join(tempRoot, 'repo', '.junie', 'plans'),
    ],
    [
      kiloAdapter,
      join(tempRoot, 'repo', '.kilo', 'plans', 'auth.md'),
      join(tempRoot, 'repo', '.kilo', 'plans'),
    ],
    [kimiCodeAdapter, join(kimiRoot, 'auth.md'), kimiRoot],
    [muxAdapter, join(muxRoot, 'project', 'workspace-a.md'), muxRoot],
    [
      qwenCodeAdapter,
      join(tempRoot, 'repo', '.qwen', 'plans', 'auth.md'),
      join(tempRoot, 'repo', '.qwen', 'plans'),
    ],
    [windsurfAdapter, join(windsurfRoot, 'auth.md'), windsurfRoot],
  ] as const;

  for (const [adapter, path, scanRoot] of cases) {
    await createPlan(path);
    expect(adapter.matches(path, scanRoot)).toBe(true);
    const plans = await adapter.parse(path, scanRoot);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.agent).toBe(adapter.agent);
    expect(plans[0]?.title).toBe('Authentication Plan');
    expect(plans[0]?.metadata.source).toBe('markdown-artifact');
    expect(plans[0]?.metadata.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(plans[0]?.metadata.sourcePaths).toEqual([path]);
  }
});

test('Antigravity rejects marker-shaped paths outside its declared roots', () => {
  const archivedPlan = join(
    tmpdir(),
    'export',
    '.gemini',
    'antigravity',
    'old',
    'implementation_plan.md',
  );

  expect(antigravityAdapter.matches(archivedPlan)).toBe(false);
});

test('Antigravity accepts plans under a discovered project marker root', () => {
  const markerRoot = join(tmpdir(), 'repo', '.gemini', 'antigravity', 'artifacts');
  const discoveredPlan = join(markerRoot, 'implementation_plan.md');

  expect(antigravityAdapter.matches(discoveredPlan, markerRoot)).toBe(true);
});

test('Gemini rejects Markdown outside a plans directory under its temp root', async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'agendex-gemini-temp-root-'));
  process.env.HOME = tempRoot;
  const tempPlansRoot = join(tempRoot, '.gemini', 'tmp');

  expect(geminiCliAdapter.matches(join(tempPlansRoot, 'session', 'notes.md'))).toBe(false);
  expect(
    geminiCliAdapter.matches(join(tempPlansRoot, 'project', 'session', 'plans', 'auth.md')),
  ).toBe(true);

  const configuredRoot = join(tempPlansRoot, 'custom');
  process.env.AGENDEX_GEMINI_CLI_PLAN_DIRS = configuredRoot;
  expect(geminiCliAdapter.matches(join(configuredRoot, 'notes.md'))).toBe(true);
});

test('marker-based adapters reject archived paths outside the concrete marker root', () => {
  const exportRoot = join(tmpdir(), 'export');
  const cases = [
    [codeBuddyAdapter, join(exportRoot, '.codebuddy', 'plans', 'auth.md')],
    [droidAdapter, join(exportRoot, '.factory', 'docs', 'auth.md')],
    [geminiCliAdapter, join(exportRoot, '.gemini', 'plans', 'auth.md')],
    [junieAdapter, join(exportRoot, '.junie', 'plans', 'auth.md')],
    [kiloAdapter, join(exportRoot, '.kilo', 'plans', 'auth.md')],
    [kiroAdapter, join(exportRoot, '.kiro', 'specs', 'oauth-login', 'tasks.md')],
    [qwenCodeAdapter, join(exportRoot, '.qwen', 'plans', 'auth.md')],
    [ohMyOpencodeAdapter, join(exportRoot, '.sisyphus', 'plans', 'auth.md')],
  ] as const;

  for (const [adapter, archivedPlan] of cases) {
    expect(adapter.matches(archivedPlan, exportRoot)).toBe(false);
  }

  expect(
    kimiCodeAdapter.matches(
      join(exportRoot, 'sessions', 'project', 'session', 'agents', 'main', 'plans', 'auth.md'),
      exportRoot,
    ),
  ).toBe(false);
});

test('Kiro combines requirements, design, and tasks into one plan', async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'agendex-kiro-adapter-'));
  const specDir = join(tempRoot, 'repo', '.kiro', 'specs', 'oauth-login');
  const requirements = join(specDir, 'requirements.md');
  const design = join(specDir, 'design.md');
  const tasks = join(specDir, 'tasks.md');
  await mkdir(specDir, { recursive: true });
  await writeFile(requirements, '# Requirements\n\nUsers can sign in.');
  await writeFile(design, '# Design\n\nUse OAuth PKCE.');
  await writeFile(tasks, '# Tasks\n\n- [ ] Implement callback');

  const markerRoot = join(tempRoot, 'repo', '.kiro', 'specs');
  const [fromRequirements] = await kiroAdapter.parse(requirements, markerRoot);
  const [fromTasks] = await kiroAdapter.parse(tasks, markerRoot);

  expect(fromRequirements?.id).toBe(fromTasks?.id);
  expect(fromTasks?.title).toBe('Oauth Login');
  expect(fromTasks?.content).toContain('## Requirements');
  expect(fromTasks?.content).toContain('## Design');
  expect(fromTasks?.content).toContain('## Tasks');
  expect(fromTasks?.filePath).toBe(tasks);
  expect(fromTasks?.metadata.sourcePaths).toEqual([requirements, design, tasks]);
  // Adapters report workspaces with POSIX separators (see normalizePath in
  // file-artifact-adapters.ts) so identity keys match across platforms.
  expect(fromTasks?.workspace).toBe(join(tempRoot, 'repo').replaceAll('\\', '/'));
});

test('writable artifact adapters persist edits', async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'agendex-writable-adapter-'));
  const path = join(tempRoot, 'repo', '.codebuddy', 'plans', 'auth.md');
  await createPlan(path);
  const [plan] = await codeBuddyAdapter.parse(path, join(tempRoot, 'repo', '.codebuddy', 'plans'));
  expect(plan).toBeDefined();
  if (!plan) throw new Error('Expected CodeBuddy plan');

  expect(await codeBuddyAdapter.write(plan, '# Revised Plan\n\n- [ ] Ship')).toBe(true);
  expect(await Bun.file(path).text()).toContain('Revised Plan');
});

test('Gemini and Qwen honor configured plan directories', async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'agendex-configured-plan-roots-'));
  process.env.HOME = tempRoot;
  const geminiSettingsDir = join(tempRoot, '.gemini');
  const qwenSettingsDir = join(tempRoot, '.qwen');
  const qwenPlans = join(tempRoot, 'qwen-custom-plans');
  await mkdir(geminiSettingsDir, { recursive: true });
  await mkdir(qwenSettingsDir, { recursive: true });
  await writeFile(
    join(geminiSettingsDir, 'settings.json'),
    JSON.stringify({ general: { plan: { directory: '.gemini/custom-plans' } } }),
  );
  await writeFile(
    join(qwenSettingsDir, 'settings.json'),
    JSON.stringify({ plansDirectory: qwenPlans }),
  );

  expect(geminiCliAdapter.getSearchPaths()).toContain(
    join(process.cwd(), '.gemini', 'custom-plans'),
  );
  expect(qwenCodeAdapter.getSearchPaths()).toContain(qwenPlans);
});
