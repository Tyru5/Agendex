import { afterEach, expect, spyOn, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capturePlanFromHook, runCapturePlanCommand } from './capture-plan.ts';

const originalConfigDir = process.env.AGENDEX_CONFIG_DIR;
let tempRoot: string | undefined;

afterEach(async () => {
  if (originalConfigDir === undefined) delete process.env.AGENDEX_CONFIG_DIR;
  else process.env.AGENDEX_CONFIG_DIR = originalConfigDir;
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
});

async function useTempRoot(): Promise<string> {
  tempRoot = await mkdtemp(join(tmpdir(), 'agendex-capture-plan-'));
  process.env.AGENDEX_CONFIG_DIR = join(tempRoot, '.agendex');
  return tempRoot;
}

test('captures an Antigravity implementation artifact into the durable plan spool', async () => {
  const root = await useTempRoot();
  const artifactDir = join(root, 'repo', '.gemini', 'antigravity', 'artifacts');
  const source = join(artifactDir, 'implementation_plan.md');
  await mkdir(artifactDir, { recursive: true });
  await writeFile(source, '# Implementation Plan\n\n- [ ] Add tests');

  const captured = await capturePlanFromHook('antigravity', {
    conversationId: 'conversation-1',
    workspacePaths: [join(root, 'repo')],
    artifactDirectoryPath: artifactDir,
  });

  expect(captured).toHaveLength(1);
  const capturedPath = captured[0];
  if (!capturedPath) throw new Error('Expected a captured plan path');
  const content = await Bun.file(capturedPath).text();
  expect(content).toContain('agent: antigravity');
  expect(content).toContain('# Implementation Plan');
  expect(capturedPath).toContain(join('plans', 'hooks', 'antigravity', 'conversation-1'));
});

test('captures iFlow plan before its transient source disappears', async () => {
  const root = await useTempRoot();
  const workspace = join(root, 'repo');
  const source = join(workspace, '.iflow', 'plan.md');
  await mkdir(join(workspace, '.iflow'), { recursive: true });
  await writeFile(source, '# iFlow Plan\n\n- [ ] Implement');

  const captured = await capturePlanFromHook('iflow-cli', {
    sessionId: 'session-1',
    workspacePaths: [workspace],
  });
  await rm(source);

  expect(captured).toHaveLength(1);
  const capturedPath = captured[0];
  if (!capturedPath) throw new Error('Expected a captured plan path');
  expect(await Bun.file(capturedPath).text()).toContain('# iFlow Plan');
});

test('capture-plan command accepts explicit inline plan fields', async () => {
  await useTempRoot();
  const result = await runCapturePlanCommand(
    ['capture-plan', '--agent', 'command-code'],
    JSON.stringify({ conversationId: 'session-1', plan: '# Plan\n\n- [ ] Ship' }),
  );
  expect(result).toBe(0);
});

test('capture-plan command rejects unsupported agents', async () => {
  await useTempRoot();
  const errorSpy = spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    expect(
      await runCapturePlanCommand(
        ['capture-plan', '--agent', 'amp'],
        JSON.stringify({ plan: '# Plan' }),
      ),
    ).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('usage'));
  } finally {
    errorSpy.mockRestore();
  }
});

test('capture rejects non-plan artifacts and file paths outside declared hook roots', async () => {
  const root = await useTempRoot();
  const source = join(root, 'private', 'plan.md');
  await mkdir(join(root, 'private'), { recursive: true });
  await writeFile(source, '# Should not be captured');

  expect(
    await capturePlanFromHook('antigravity', {
      conversationId: 'session-1',
      toolCall: { args: { filePath: source } },
      artifact: { type: 'walkthrough', content: '# Not a plan' },
    }),
  ).toEqual([]);
});

test('capture rejects plan symlinks that escape declared hook roots', async () => {
  const root = await useTempRoot();
  const workspace = join(root, 'repo');
  const privatePlan = join(root, 'private-plan.md');
  const linkedPlan = join(workspace, 'plan.md');
  await mkdir(workspace, { recursive: true });
  await writeFile(privatePlan, '# Private Plan\n\n- [ ] Do not capture');
  await symlink(privatePlan, linkedPlan);

  expect(
    await capturePlanFromHook('augment', {
      conversationId: 'session-1',
      workspacePaths: [workspace],
      toolCall: { args: { filePath: linkedPlan } },
    }),
  ).toEqual([]);
});
