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

const ENV_NAMES = [
  'HOME',
  'AGENDEX_GITHUB_COPILOT_PLAN_DIRS',
  'AGENDEX_KIMI_CODE_PLAN_DIRS',
  'AGENDEX_MUX_PLAN_DIRS',
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
  const kimiRoot = join(tempRoot, 'kimi', 'plans');
  const muxRoot = join(tempRoot, 'mux-plans');
  const windsurfRoot = join(tempRoot, 'windsurf-plans');
  process.env.AGENDEX_GITHUB_COPILOT_PLAN_DIRS = copilotRoot;
  process.env.AGENDEX_KIMI_CODE_PLAN_DIRS = kimiRoot;
  process.env.AGENDEX_MUX_PLAN_DIRS = muxRoot;
  process.env.AGENDEX_WINDSURF_PLAN_DIRS = windsurfRoot;

  const cases = [
    [
      antigravityAdapter,
      join(tempRoot, 'repo', '.gemini', 'antigravity', 'artifacts', 'implementation_plan.md'),
    ],
    [codeBuddyAdapter, join(tempRoot, 'repo', '.codebuddy', 'plans', 'auth.md')],
    [droidAdapter, join(tempRoot, 'repo', '.factory', 'docs', '2026-07-09-auth.md')],
    [geminiCliAdapter, join(tempRoot, 'repo', '.gemini', 'plans', 'auth.md')],
    [githubCopilotAdapter, join(copilotRoot, 'session-1', 'plan.md')],
    [junieAdapter, join(tempRoot, 'repo', '.junie', 'plans', 'auth.md')],
    [kiloAdapter, join(tempRoot, 'repo', '.kilo', 'plans', 'auth.md')],
    [kimiCodeAdapter, join(kimiRoot, 'auth.md')],
    [muxAdapter, join(muxRoot, 'project', 'workspace-a.md')],
    [qwenCodeAdapter, join(tempRoot, 'repo', '.qwen', 'plans', 'auth.md')],
    [windsurfAdapter, join(windsurfRoot, 'auth.md')],
  ] as const;

  for (const [adapter, path] of cases) {
    await createPlan(path);
    expect(adapter.matches(path)).toBe(true);
    const plans = await adapter.parse(path);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.agent).toBe(adapter.agent);
    expect(plans[0]?.title).toBe('Authentication Plan');
    expect(plans[0]?.metadata.source).toBe('markdown-artifact');
    expect(plans[0]?.metadata.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(plans[0]?.metadata.sourcePaths).toEqual([path]);
  }
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

  const [fromRequirements] = await kiroAdapter.parse(requirements);
  const [fromTasks] = await kiroAdapter.parse(tasks);

  expect(fromRequirements?.id).toBe(fromTasks?.id);
  expect(fromTasks?.title).toBe('Oauth Login');
  expect(fromTasks?.content).toContain('## Requirements');
  expect(fromTasks?.content).toContain('## Design');
  expect(fromTasks?.content).toContain('## Tasks');
  expect(fromTasks?.filePath).toBe(tasks);
  expect(fromTasks?.metadata.sourcePaths).toEqual([requirements, design, tasks]);
  expect(fromTasks?.workspace).toBe(join(tempRoot, 'repo'));
});

test('writable artifact adapters persist edits', async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'agendex-writable-adapter-'));
  const path = join(tempRoot, 'repo', '.codebuddy', 'plans', 'auth.md');
  await createPlan(path);
  const [plan] = await codeBuddyAdapter.parse(path);
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
