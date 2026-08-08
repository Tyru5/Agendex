import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { getActiveAdapters, setActiveAdapters } from '../adapters/registry.ts';
import { getConfigDir, saveConfig } from '../config.ts';
import { hashPath } from '../hash.ts';
import type { AgentAdapter, Plan } from '../types.ts';
import {
  discoverProjectPlanDirs,
  getAgentStats,
  getAll,
  getIndexableById,
  getIndexablePlans,
  rescanFile,
  scan,
} from './plan-service.ts';

const originalAdapters = getActiveAdapters();
const originalCwd = process.cwd();
const originalEnv: Record<string, string | undefined> = {
  AGENDEX_CONFIG_DIR: process.env.AGENDEX_CONFIG_DIR,
  AGENDEX_DEV: process.env.AGENDEX_DEV,
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  HOMEDRIVE: process.env.HOMEDRIVE,
  HOMEPATH: process.env.HOMEPATH,
};

let tempHome: string | undefined;

function restoreEnv(name: keyof typeof originalEnv) {
  const value = originalEnv[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(async () => {
  setActiveAdapters(originalAdapters);
  process.chdir(originalCwd);
  restoreEnv('AGENDEX_CONFIG_DIR');
  restoreEnv('AGENDEX_DEV');
  restoreEnv('HOME');
  restoreEnv('USERPROFILE');
  restoreEnv('HOMEDRIVE');
  restoreEnv('HOMEPATH');

  if (tempHome) {
    await rm(tempHome, { recursive: true, force: true });
    tempHome = undefined;
  }
});

async function useTempHome(prefix: string): Promise<string> {
  tempHome = await mkdtemp(join(tmpdir(), prefix));
  const parsedHome = parse(tempHome);

  process.env.AGENDEX_CONFIG_DIR = join(tempHome, '.agendex-dev');
  process.env.AGENDEX_DEV = '1';
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  process.env.HOMEDRIVE = parsedHome.root.slice(0, 2);
  process.env.HOMEPATH = tempHome.slice(parsedHome.root.length - 1);

  return tempHome;
}

// Adding a plan source during a scan should be indexed before the mutating request returns.
test('overlapping scan requests queue one serialized follow-up traversal', async () => {
  const home = await useTempHome('agendex-serialized-scan-');
  const plansDir = join(home, 'agent-plans');
  const planPath = join(plansDir, 'first.md');
  const addedPlanPath = join(plansDir, 'added.md');
  await mkdir(plansDir, { recursive: true });
  await writeFile(planPath, '# Plan', 'utf8');

  const parsedPaths: string[] = [];
  let releaseParse: (() => void) | undefined;
  const parseGate = new Promise<void>((resolve) => {
    releaseParse = resolve;
  });
  const adapter: AgentAdapter = {
    agent: 'test',
    writable: false,
    getSearchPaths: () => [plansDir],
    getWatchPaths: () => [],
    matches: (filePath) => filePath.endsWith('.md'),
    parse: async (filePath) => {
      parsedPaths.push(filePath);
      if (filePath === planPath && parsedPaths.length === 1) await parseGate;
      return [
        {
          id: hashPath(filePath),
          agent: 'test',
          title: 'Indexed plan',
          content: '# Indexed plan\n\nImplement the complete change and verify it.',
          filePath,
          format: 'md',
          createdAt: new Date(0),
          updatedAt: new Date(0),
          metadata: {},
        },
      ];
    },
    write: async () => false,
  };
  setActiveAdapters([adapter]);

  const first = scan();
  while (parsedPaths.length === 0) await Bun.sleep(1);
  await writeFile(addedPlanPath, '# Added plan', 'utf8');
  const second = scan();
  expect(second).toBe(first);
  releaseParse?.();
  await Promise.all([first, second]);

  expect(parsedPaths.filter((filePath) => filePath === planPath)).toHaveLength(2);
  expect(parsedPaths).toContain(addedPlanPath);
  expect(getAll().map((plan) => plan.filePath)).toContain(addedPlanPath);
});

// Slow WSL safety polls must not keep extending a scan queue that can never drain.
test('passive polling coalesces without queuing a follow-up traversal', async () => {
  const home = await useTempHome('agendex-passive-scan-');
  const plansDir = join(home, 'agent-plans');
  const planPath = join(plansDir, 'plan.md');
  await mkdir(plansDir, { recursive: true });
  await writeFile(planPath, '# Plan', 'utf8');

  let parseCalls = 0;
  let releaseParse: (() => void) | undefined;
  const parseGate = new Promise<void>((resolve) => {
    releaseParse = resolve;
  });
  const adapter: AgentAdapter = {
    agent: 'test',
    writable: false,
    getSearchPaths: () => [plansDir],
    getWatchPaths: () => [],
    matches: (filePath) => filePath === planPath,
    parse: async () => {
      parseCalls += 1;
      await parseGate;
      return [];
    },
    write: async () => false,
  };
  setActiveAdapters([adapter]);

  const first = scan();
  while (parseCalls === 0) await Bun.sleep(1);
  const passive = scan({ queueIfBusy: false });
  releaseParse?.();
  await Promise.all([first, passive]);

  expect(parseCalls).toBe(1);
});

// A failed traversal must release queued callers and allow the next refresh to recover.
test('scan queue clears after a traversal failure', async () => {
  const home = await useTempHome('agendex-failed-scan-');
  const plansDir = join(home, 'agent-plans');
  const planPath = join(plansDir, 'plan.md');
  await mkdir(plansDir, { recursive: true });
  await writeFile(planPath, '# Plan', 'utf8');

  let attempts = 0;
  let releaseFailure: (() => void) | undefined;
  const failureGate = new Promise<void>((resolve) => {
    releaseFailure = resolve;
  });
  const adapter: AgentAdapter = {
    agent: 'test',
    writable: false,
    getSearchPaths: () => [plansDir],
    getWatchPaths: () => [],
    matches: (filePath) => filePath === planPath,
    parse: async () => {
      attempts += 1;
      if (attempts === 1) {
        await failureGate;
        throw new Error('scan failed');
      }
      return [];
    },
    write: async () => false,
  };
  setActiveAdapters([adapter]);

  const first = scan();
  while (attempts === 0) await Bun.sleep(1);
  const queued = scan();
  expect(queued).toBe(first);
  const outcome = first.then(
    () => null,
    (error: unknown) => error,
  );
  releaseFailure?.();

  const failure = await outcome;
  expect(failure instanceof Error).toBe(true);
  expect((failure as Error).message).toBe('scan failed');
  await scan();
  expect(attempts).toBe(2);
});

test('discovers documented project-local plan markers', async () => {
  const home = await useTempHome('agendex-project-markers-');
  const workspace = join(home, 'workspace');
  const markers = [
    ['.codebuddy/plans', 'codebuddy'],
    ['.factory/docs', 'droid'],
    ['.gemini/antigravity/artifacts', 'antigravity'],
    ['.gemini/plans', 'gemini-cli'],
    ['.junie/plans', 'junie'],
    ['.kilo/plans', 'kilo-cli'],
    ['.kiro/specs', 'kiro-cli'],
    ['.qwen/plans', 'qwen-code'],
  ] as const;
  for (const [marker] of markers) await mkdir(join(workspace, marker), { recursive: true });
  process.chdir(workspace);

  const discovered = discoverProjectPlanDirs();
  for (const [marker, agent] of markers) {
    expect(discovered).toContainEqual({ dir: await realpath(join(workspace, marker)), agent });
  }
});

test('scan keeps adapter-parsed plans when a custom dir overlaps a discovered project dir', async () => {
  tempHome = await mkdtemp(join(tmpdir(), 'agendex-plan-service-'));
  const parsedHome = parse(tempHome);

  process.env.AGENDEX_CONFIG_DIR = join(tempHome, '.agendex-dev');
  process.env.AGENDEX_DEV = '1';
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  process.env.HOMEDRIVE = parsedHome.root.slice(0, 2);
  process.env.HOMEPATH = tempHome.slice(parsedHome.root.length - 1);

  const workspaceDir = join(tempHome, 'workspace');
  const discoveredDir = join(workspaceDir, '.sisyphus', 'plans');
  const planPath = join(discoveredDir, 'roadmap.md');

  await mkdir(discoveredDir, { recursive: true });
  await writeFile(planPath, '# Generic title\n\nGeneric content\n', 'utf-8');
  const canonicalPlanPath = await realpath(planPath);
  process.chdir(workspaceDir);

  saveConfig({
    configVersion: 3,
    enabledAdapters: [],
    customPlanDirs: [discoveredDir],
  });

  const adapterPlan: Plan = {
    id: hashPath(planPath),
    agent: 'oh-my-opencode',
    title: 'Adapter Title',
    content: 'Adapter Content',
    filePath: planPath,
    format: 'md',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    workspace: workspaceDir,
    metadata: { source: 'adapter', rich: true },
  };

  const adapter: AgentAdapter = {
    agent: 'oh-my-opencode',
    writable: false,
    getSearchPaths: () => [],
    getWatchPaths: () => [],
    matches: (filePath) => filePath.endsWith('.md'),
    parse: async (filePath) =>
      (await realpath(filePath)) === canonicalPlanPath ? [adapterPlan] : [],
    write: async () => false,
  };

  setActiveAdapters([adapter]);

  await scan();

  const plans = getAll();
  expect(plans).toHaveLength(1);
  expect(plans[0]).toMatchObject({
    id: adapterPlan.id,
    title: adapterPlan.title,
    content: adapterPlan.content,
    workspace: workspaceDir,
    metadata: adapterPlan.metadata,
  });
});

test('scan keeps adapter-parsed plans when custom dir is a parent of adapter/discovered coverage', async () => {
  tempHome = await mkdtemp(join(tmpdir(), 'agendex-plan-service-parent-'));
  const parsedHome = parse(tempHome);

  process.env.AGENDEX_CONFIG_DIR = join(tempHome, '.agendex-dev');
  process.env.AGENDEX_DEV = '1';
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  process.env.HOMEDRIVE = parsedHome.root.slice(0, 2);
  process.env.HOMEPATH = tempHome.slice(parsedHome.root.length - 1);

  const workspaceDir = join(tempHome, 'workspace');
  const discoveredDir = join(workspaceDir, '.sisyphus', 'plans');
  const planPath = join(discoveredDir, 'roadmap.md');

  await mkdir(discoveredDir, { recursive: true });
  await writeFile(planPath, '# Generic title\n\nGeneric content\n', 'utf-8');
  const canonicalPlanPath = await realpath(planPath);
  process.chdir(workspaceDir);

  saveConfig({
    configVersion: 3,
    enabledAdapters: [],
    customPlanDirs: [workspaceDir],
  });

  const adapterPlan: Plan = {
    id: hashPath(planPath),
    agent: 'oh-my-opencode',
    title: 'Adapter Title',
    content: 'Adapter Content',
    filePath: planPath,
    format: 'md',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    workspace: workspaceDir,
    metadata: { source: 'adapter', rich: true },
  };

  const adapter: AgentAdapter = {
    agent: 'oh-my-opencode',
    writable: false,
    getSearchPaths: () => [],
    getWatchPaths: () => [],
    matches: (filePath) => filePath.endsWith('.md'),
    parse: async (filePath) =>
      (await realpath(filePath)) === canonicalPlanPath ? [adapterPlan] : [],
    write: async () => false,
  };

  setActiveAdapters([adapter]);

  await scan();

  const plans = getAll();
  expect(plans).toHaveLength(1);
  expect(plans[0]).toMatchObject({
    id: adapterPlan.id,
    title: adapterPlan.title,
    content: adapterPlan.content,
    workspace: workspaceDir,
    metadata: adapterPlan.metadata,
  });
});

test('concurrent getAll during scan sees previous snapshot until scan completes', async () => {
  tempHome = await mkdtemp(join(tmpdir(), 'agendex-plan-service-race-'));
  const parsedHome = parse(tempHome);

  process.env.AGENDEX_CONFIG_DIR = join(tempHome, '.agendex-dev');
  process.env.AGENDEX_DEV = '1';
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  process.env.HOMEDRIVE = parsedHome.root.slice(0, 2);
  process.env.HOMEPATH = tempHome.slice(parsedHome.root.length - 1);

  const plansDir = join(tempHome, 'plans');
  const planPath = join(plansDir, 'p.md');
  await mkdir(plansDir, { recursive: true });
  await writeFile(planPath, '# T\n\nbody\n', 'utf-8');

  const adapterPlan: Plan = {
    id: hashPath(planPath),
    agent: 'test-agent',
    title: 'T',
    content: 'body',
    filePath: planPath,
    format: 'md',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    metadata: {},
  };

  let parseCalls = 0;
  const adapter: AgentAdapter = {
    agent: 'test-agent',
    writable: false,
    getSearchPaths: () => [plansDir],
    getWatchPaths: () => [],
    matches: (filePath) => filePath.endsWith('.md'),
    parse: async (filePath) => {
      parseCalls += 1;
      if (parseCalls > 1) {
        await new Promise((r) => setTimeout(r, 150));
      }
      return filePath === planPath ? [adapterPlan] : [];
    },
    write: async () => false,
  };

  setActiveAdapters([adapter]);
  await scan();
  expect(getAll()).toHaveLength(1);

  const second = scan();
  await new Promise((r) => setTimeout(r, 30));
  expect(getAll()).toHaveLength(1);
  await second;
  expect(getAll()).toHaveLength(1);
});

test('rescanFile continues to later matching adapters when an empty adapter does not own the stored plan', async () => {
  tempHome = await mkdtemp(join(tmpdir(), 'agendex-plan-service-rescan-'));
  const parsedHome = parse(tempHome);

  process.env.AGENDEX_CONFIG_DIR = join(tempHome, '.agendex-dev');
  process.env.AGENDEX_DEV = '1';
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  process.env.HOMEDRIVE = parsedHome.root.slice(0, 2);
  process.env.HOMEPATH = tempHome.slice(parsedHome.root.length - 1);

  const plansDir = join(tempHome, 'plans');
  const planPath = join(plansDir, 'p.md');
  await mkdir(plansDir, { recursive: true });
  await writeFile(planPath, '# T\n\nbody\n', 'utf-8');

  const adapterPlan: Plan = {
    id: hashPath(planPath),
    agent: 'second-agent',
    title: 'T',
    content: 'body',
    filePath: planPath,
    format: 'md',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    metadata: {},
  };

  const emptyAdapter: AgentAdapter = {
    agent: 'first-agent',
    writable: false,
    getSearchPaths: () => [plansDir],
    getWatchPaths: () => [],
    matches: (filePath) => filePath.endsWith('.md'),
    parse: async () => [],
    write: async () => false,
  };
  const owningAdapter: AgentAdapter = {
    agent: 'second-agent',
    writable: false,
    getSearchPaths: () => [plansDir],
    getWatchPaths: () => [],
    matches: (filePath) => filePath.endsWith('.md'),
    parse: async (filePath) => (filePath === planPath ? [adapterPlan] : []),
    write: async () => false,
  };

  setActiveAdapters([emptyAdapter, owningAdapter]);
  await scan();
  expect(getAll()).toHaveLength(1);

  const rescanned = await rescanFile(planPath);

  expect(rescanned).toHaveLength(1);
  expect(getAll()).toHaveLength(1);
  expect(getAll()[0]).toMatchObject({ id: adapterPlan.id, agent: 'second-agent' });
});

test('rescanFile removes empty results owned by the matching adapter', async () => {
  tempHome = await mkdtemp(join(tmpdir(), 'agendex-plan-service-rescan-owned-'));
  const parsedHome = parse(tempHome);

  process.env.AGENDEX_CONFIG_DIR = join(tempHome, '.agendex-dev');
  process.env.AGENDEX_DEV = '1';
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  process.env.HOMEDRIVE = parsedHome.root.slice(0, 2);
  process.env.HOMEPATH = tempHome.slice(parsedHome.root.length - 1);

  const plansDir = join(tempHome, 'plans');
  const planPath = join(plansDir, 'p.md');
  await mkdir(plansDir, { recursive: true });
  await writeFile(planPath, '# T\n\nbody\n', 'utf-8');

  const adapterPlan: Plan = {
    id: hashPath(planPath),
    agent: 'owned-agent',
    title: 'T',
    content: 'body',
    filePath: planPath,
    format: 'md',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    metadata: {},
  };

  let shouldParse = true;
  const adapter: AgentAdapter = {
    agent: 'owned-agent',
    writable: false,
    getSearchPaths: () => [plansDir],
    getWatchPaths: () => [],
    matches: (filePath) => filePath.endsWith('.md'),
    parse: async (filePath) => (shouldParse && filePath === planPath ? [adapterPlan] : []),
    write: async () => false,
  };

  setActiveAdapters([adapter]);
  await scan();
  expect(getAll()).toHaveLength(1);

  shouldParse = false;
  const rescanned = await rescanFile(planPath);

  expect(rescanned).toHaveLength(1);
  expect(rescanned[0]).toMatchObject({ id: adapterPlan.id, agent: 'owned-agent' });
  expect(getAll()).toHaveLength(0);
});

test('rescanFile removes plans that disappear from a multi-plan source', async () => {
  const home = await useTempHome('agendex-plan-service-multi-source-');
  const plansDir = join(home, 'structured');
  const sourcePath = join(plansDir, 'sessions.db');
  await mkdir(plansDir, { recursive: true });
  await writeFile(sourcePath, 'fixture');

  const plan = (id: string): Plan => ({
    id,
    agent: 'structured-agent',
    title: id,
    content: `# ${id}`,
    filePath: sourcePath,
    format: 'sqlite',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    metadata: { sourcePaths: [sourcePath] },
  });
  let plans = [plan('a'), plan('b')];
  const adapter: AgentAdapter = {
    agent: 'structured-agent',
    writable: false,
    getSearchPaths: () => [plansDir],
    getWatchPaths: () => [plansDir],
    getSourcePath: () => sourcePath,
    matches: (filePath) => filePath === sourcePath || filePath === `${sourcePath}-wal`,
    parse: async () => plans,
    write: async () => false,
  };

  setActiveAdapters([adapter]);
  await scan();
  expect(
    getAll()
      .map(({ id }) => id)
      .sort(),
  ).toEqual(['a', 'b']);

  plans = [plan('a')];
  await rescanFile(`${sourcePath}-wal`);

  expect(getAll().map(({ id }) => id)).toEqual(['a']);
});

test('discoverProjectPlanDirs keeps the nearest current-project marker when ancestors also match', async () => {
  tempHome = await mkdtemp(join(tmpdir(), 'agendex-plan-service-nearest-marker-'));
  const parsedHome = parse(tempHome);

  process.env.AGENDEX_CONFIG_DIR = join(tempHome, '.agendex-dev');
  process.env.AGENDEX_DEV = '1';
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  process.env.HOMEDRIVE = parsedHome.root.slice(0, 2);
  process.env.HOMEPATH = tempHome.slice(parsedHome.root.length - 1);

  const workspaceDir = join(tempHome, 'workspace');
  const projectDir = join(workspaceDir, 'project');
  const cwd = join(projectDir, 'src');
  const parentPlansDir = join(workspaceDir, '@plans');
  const projectPlansDir = join(projectDir, '@plans');

  await mkdir(parentPlansDir, { recursive: true });
  await mkdir(projectPlansDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  process.chdir(cwd);

  const discovered = discoverProjectPlanDirs()
    .filter((dir) => dir.agent === 'plannotator')
    .map((dir) => dir.dir);

  expect(discovered).toContain(await realpath(projectPlansDir));
  expect(discovered).not.toContain(await realpath(parentPlansDir));
});

test('scan annotates low-value adapter-derived plans while excluding them from indexable results', async () => {
  const home = await useTempHome('agendex-plan-service-low-value-');
  const plansDir = join(home, 'adapter-plans');
  const planPath = join(plansDir, 'prompt.md');
  await mkdir(plansDir, { recursive: true });
  await writeFile(planPath, 'Please fix the login bug', 'utf-8');

  saveConfig({
    configVersion: 3,
    enabledAdapters: [],
    customPlanDirs: [],
  });

  const adapterPlan: Plan = {
    id: hashPath(planPath),
    agent: 'test-agent',
    title: 'Prompt',
    content: 'Please fix the login bug',
    filePath: planPath,
    format: 'md',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    metadata: { source: 'adapter' },
  };

  const adapter: AgentAdapter = {
    agent: 'test-agent',
    writable: false,
    getSearchPaths: () => [plansDir],
    getWatchPaths: () => [],
    matches: (filePath) => filePath.endsWith('.md'),
    parse: async (filePath) => (filePath === planPath ? [adapterPlan] : []),
    write: async () => false,
  };

  setActiveAdapters([adapter]);
  await scan();

  const plans = getAll();
  expect(plans).toHaveLength(1);
  expect(plans[0]?.metadata.source).toBe('adapter');
  expect(plans[0]?.metadata.lowValue).toBe(true);
  expect(plans[0]?.metadata.lowValueReasons).toContain('prompt-like');
  expect(getIndexablePlans()).toHaveLength(0);
  expect(getIndexableById(adapterPlan.id)).toBeUndefined();
  expect(getAgentStats().find((stat) => stat.agent === 'test-agent')?.planCount).toBe(0);
});

test('rescanFile annotates low-value adapter-derived plans', async () => {
  const home = await useTempHome('agendex-plan-service-rescan-low-value-');
  const plansDir = join(home, 'adapter-plans');
  const planPath = join(plansDir, 'prompt.md');
  await mkdir(plansDir, { recursive: true });
  await writeFile(planPath, 'Please update the README', 'utf-8');

  const adapterPlan: Plan = {
    id: hashPath(planPath),
    agent: 'test-agent',
    title: 'Prompt',
    content: 'Please update the README',
    filePath: planPath,
    format: 'md',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    metadata: { source: 'adapter' },
  };

  const adapter: AgentAdapter = {
    agent: 'test-agent',
    writable: false,
    getSearchPaths: () => [plansDir],
    getWatchPaths: () => [],
    matches: (filePath) => filePath.endsWith('.md'),
    parse: async (filePath) => (filePath === planPath ? [adapterPlan] : []),
    write: async () => false,
  };

  setActiveAdapters([adapter]);

  const plans = await rescanFile(planPath);

  expect(plans).toHaveLength(1);
  expect(plans[0]?.metadata.lowValue).toBe(true);
  expect(getAll().find((plan) => plan.id === adapterPlan.id)?.metadata.lowValue).toBe(true);
  expect(getIndexablePlans()).toHaveLength(0);
  expect(getIndexableById(adapterPlan.id)).toBeUndefined();
});

test('scan annotates low-value user-created and custom markdown plans', async () => {
  const home = await useTempHome('agendex-plan-service-source-scope-');
  const userPlansDir = join(getConfigDir(), 'plans');
  const userPlanPath = join(userPlansDir, 'heading-only.md');
  const customDir = join(home, 'custom-plans');
  const customPlanPath = join(customDir, 'prompt.md');

  await mkdir(userPlansDir, { recursive: true });
  await mkdir(customDir, { recursive: true });
  await writeFile(userPlanPath, '# Heading Only\n', 'utf-8');
  await writeFile(customPlanPath, 'Please fix login', 'utf-8');

  saveConfig({
    configVersion: 3,
    enabledAdapters: [],
    customPlanDirs: [customDir],
  });
  setActiveAdapters([]);

  await scan();

  const plans = getAll();
  expect(plans).toHaveLength(2);

  const userPlan = plans.find((plan) => plan.filePath === userPlanPath);
  const customPlan = plans.find((plan) => plan.filePath === customPlanPath);

  expect(userPlan?.metadata.userCreated).toBe(true);
  expect(userPlan?.metadata.lowValue).toBe(true);
  expect(userPlan?.metadata.lowValueReasons).toContain('heading-only');
  expect(customPlan?.metadata.source).toBe('custom-dir');
  expect(customPlan?.metadata.lowValue).toBe(true);
  expect(customPlan?.metadata.lowValueReasons).toContain('prompt-like');
  expect(getIndexablePlans()).toHaveLength(0);
});

test('scan keeps valuable user-created and custom markdown plans indexable', async () => {
  const home = await useTempHome('agendex-plan-service-valuable-source-scope-');
  const userPlansDir = join(getConfigDir(), 'plans');
  const userPlanPath = join(userPlansDir, 'checklist.md');
  const customDir = join(home, 'custom-plans');
  const customPlanPath = join(customDir, 'structured.md');

  await mkdir(userPlansDir, { recursive: true });
  await mkdir(customDir, { recursive: true });
  await writeFile(userPlanPath, '- [ ] Fix login bug\n', 'utf-8');
  await writeFile(
    customPlanPath,
    '# Plan\n\n## Approach\nAdd validation.\n\n## Steps\n- [ ] Implement helper\n- [ ] Add tests\n',
    'utf-8',
  );

  saveConfig({
    configVersion: 3,
    enabledAdapters: [],
    customPlanDirs: [customDir],
  });
  setActiveAdapters([]);

  await scan();

  const plans = getAll();
  expect(plans).toHaveLength(2);
  expect(plans.every((plan) => plan.metadata.lowValue !== true)).toBe(true);
  expect(getIndexablePlans()).toHaveLength(2);
});

test('rescanFile annotates user-created and custom markdown plans', async () => {
  const home = await useTempHome('agendex-plan-service-rescan-source-scope-');
  const userPlansDir = join(getConfigDir(), 'plans');
  const userPlanPath = join(userPlansDir, 'heading-only.md');
  const customDir = join(home, 'custom-plans');
  const customPlanPath = join(customDir, 'code.md');

  await mkdir(userPlansDir, { recursive: true });
  await mkdir(customDir, { recursive: true });
  await writeFile(userPlanPath, '# Heading Only\n', 'utf-8');
  await writeFile(customPlanPath, '```ts\nexport const x = 1;\n```', 'utf-8');

  saveConfig({
    configVersion: 3,
    enabledAdapters: [],
    customPlanDirs: [customDir],
  });
  setActiveAdapters([]);
  await scan();

  const userPlans = await rescanFile(userPlanPath);
  const customPlans = await rescanFile(customPlanPath);

  expect(userPlans[0]?.metadata.lowValue).toBe(true);
  expect(userPlans[0]?.metadata.lowValueReasons).toContain('heading-only');
  expect(customPlans[0]?.metadata.lowValue).toBe(true);
  expect(customPlans[0]?.metadata.lowValueReasons).toContain('code-only');
  expect(getIndexablePlans()).toHaveLength(0);
});
