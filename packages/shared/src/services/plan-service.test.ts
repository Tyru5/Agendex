import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { getActiveAdapters, setActiveAdapters } from '../adapters/registry.ts';
import { getConfigDir, saveConfig } from '../config.ts';
import { hashPath } from '../hash.ts';
import type { AgentAdapter, Plan } from '../types.ts';
import {
  getAgentStats,
  getAll,
  getIndexableById,
  getIndexablePlans,
  rescanFile,
  scan,
} from './plan-service.ts';

const originalAdapters = getActiveAdapters();
const originalEnv: Record<string, string | undefined> = {
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

async function useTempHome(prefix: string): Promise<string> {
  tempHome = await mkdtemp(join(tmpdir(), prefix));
  const parsedHome = parse(tempHome);

  process.env.AGENDEX_DEV = '1';
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  process.env.HOMEDRIVE = parsedHome.root.slice(0, 2);
  process.env.HOMEPATH = tempHome.slice(parsedHome.root.length - 1);

  return tempHome;
}

afterEach(async () => {
  setActiveAdapters(originalAdapters);
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

test('scan keeps adapter-parsed plans when a custom dir overlaps a discovered project dir', async () => {
  tempHome = await mkdtemp(join(tmpdir(), 'agendex-plan-service-'));
  const parsedHome = parse(tempHome);

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
    parse: async (filePath) => (filePath === planPath ? [adapterPlan] : []),
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
    parse: async (filePath) => (filePath === planPath ? [adapterPlan] : []),
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

test('scan does not annotate user-created or custom markdown plans', async () => {
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
  expect(userPlan?.metadata.lowValue).toBeUndefined();
  expect(customPlan?.metadata.source).toBe('custom-dir');
  expect(customPlan?.metadata.lowValue).toBeUndefined();
  expect(getIndexablePlans()).toHaveLength(2);
});
