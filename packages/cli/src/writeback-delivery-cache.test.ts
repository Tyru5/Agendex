import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadDeliveredWritebackIds,
  saveDeliveredWritebackIds,
} from './writeback-delivery-cache.ts';

const originalConfigDir = process.env.AGENDEX_CONFIG_DIR;
let tempRoot: string | undefined;

async function useTempConfigDir() {
  tempRoot = await mkdtemp(join(tmpdir(), 'agendex-writeback-cache-'));
  process.env.AGENDEX_CONFIG_DIR = join(tempRoot, '.agendex-test');
  return process.env.AGENDEX_CONFIG_DIR;
}

afterEach(async () => {
  if (originalConfigDir === undefined) delete process.env.AGENDEX_CONFIG_DIR;
  else process.env.AGENDEX_CONFIG_DIR = originalConfigDir;

  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

test('persists delivered Plannotator write-back ids in the config dir', async () => {
  await useTempConfigDir();

  expect(saveDeliveredWritebackIds(new Set(['job-1', 'job-2']))).toBe(true);

  expect(loadDeliveredWritebackIds()).toEqual(new Set(['job-1', 'job-2']));
});

test('ignores malformed delivered write-back cache files', async () => {
  const configDir = await useTempConfigDir();
  await mkdir(configDir, { recursive: true });
  await writeFile(join(configDir, 'plannotator-writebacks-delivered.json'), 'not json', 'utf-8');

  expect(loadDeliveredWritebackIds()).toEqual(new Set());
});
