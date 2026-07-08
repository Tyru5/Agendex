import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { computePlanSyncIdentity } from '../services/plan-sync-identity.ts';
import { getActiveAdapters, setActiveAdapters } from './registry.ts';

const originalAdapters = getActiveAdapters();
const originalEnv: Record<string, string | undefined> = {
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

async function useTempHome() {
  tempHome = await mkdtemp(join(tmpdir(), 'agendex-cursor-'));
  const parsedHome = parse(tempHome);
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  process.env.HOMEDRIVE = parsedHome.root.slice(0, 2);
  process.env.HOMEPATH = tempHome.slice(parsedHome.root.length - 1);
  return tempHome;
}

afterEach(async () => {
  setActiveAdapters(originalAdapters);
  for (const key of Object.keys(originalEnv) as Array<keyof typeof originalEnv>) {
    restoreEnv(key);
  }
  if (tempHome) {
    await rm(tempHome, { recursive: true, force: true });
    tempHome = undefined;
  }
});

test('discovers the global ~/.cursor/plans directory', async () => {
  const home = await useTempHome();
  const globalPlansDir = join(home, '.cursor', 'plans');
  await mkdir(globalPlansDir, { recursive: true });

  const { cursorAdapter } = await import('./cursor.ts');
  expect(cursorAdapter.getSearchPaths()).toContain(globalPlansDir);
});

test('parses global cursor plans without treating home as workspace', async () => {
  const home = await useTempHome();
  const globalPlansDir = join(home, '.cursor', 'plans');
  await mkdir(globalPlansDir, { recursive: true });

  const planPath = join(globalPlansDir, 'Spec-writer Fable model-12fbcd40.plan.md');
  await writeFile(
    planPath,
    `<!-- 12fbcd40-8e34-469a-b203-49e81f0f8d48 -->
---
isProject: false
---
# Spec-writer default model

- [ ] Update persona
`,
    'utf-8',
  );

  const { cursorAdapter } = await import('./cursor.ts');
  const [plan] = await cursorAdapter.parse(planPath);

  expect(plan?.workspace).toBeUndefined();
  expect(plan?.metadata.source).toBe('global-cursor');
  expect(plan?.metadata.userPlansDir).toBe(globalPlansDir);
  expect(plan?.metadata.sessionId).toBe('12fbcd40-8e34-469a-b203-49e81f0f8d48');
  expect(plan?.title).toBe('Spec-writer default model');
});

test('global cursor plans get stable sync identity from session id and path fallback', async () => {
  const home = await useTempHome();
  const globalPlansDir = join(home, '.cursor', 'plans');
  const planPath = join(globalPlansDir, 'Spec-writer Fable model-12fbcd40.plan.md');

  const withSession = computePlanSyncIdentity({
    agent: 'cursor',
    title: 'Spec-writer default model',
    content: '# Spec-writer default model\n\n- [ ] Update persona\n',
    format: 'md',
    filePath: planPath,
    metadata: {
      sessionId: '12fbcd40-8e34-469a-b203-49e81f0f8d48',
      source: 'global-cursor',
      userPlansDir: globalPlansDir,
    },
  });

  expect(withSession.syncIdentityKey).toBe(
    'v1:cursor:metadata:sessionId:12fbcd40-8e34-469a-b203-49e81f0f8d48',
  );
  expect(withSession.identityStrength).toBe('strong');

  const withoutSession = computePlanSyncIdentity({
    agent: 'cursor',
    title: 'Spec-writer default model',
    content: '# Spec-writer default model\n\n- [ ] Update persona\n',
    format: 'md',
    filePath: planPath,
    metadata: {
      source: 'global-cursor',
      userPlansDir: globalPlansDir,
    },
  });

  expect(withoutSession.syncIdentityKey).toBe(
    'v1:cursor:global-cursor:path:Spec-writer Fable model-12fbcd40.plan.md',
  );
  expect(withoutSession.identityStrength).toBe('path');
});
