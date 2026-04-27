import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadPendingWritebackReports,
  savePendingWritebackReports,
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

test('persists pending Plannotator write-back reports in the config dir', async () => {
  await useTempConfigDir();

  expect(
    savePendingWritebackReports(
      new Map([
        ['job-1', 'sent'],
        ['job-2', 'expired'],
      ]),
    ),
  ).toBe(true);

  expect(loadPendingWritebackReports()).toEqual(
    new Map([
      ['job-1', 'sent'],
      ['job-2', 'expired'],
    ]),
  );
});

test('loads legacy delivered write-back id cache files as sent reports', async () => {
  const configDir = await useTempConfigDir();
  await mkdir(configDir, { recursive: true });
  await writeFile(
    join(configDir, 'plannotator-writebacks-delivered.json'),
    JSON.stringify(['job-1', 'job-2']),
    'utf-8',
  );

  expect(loadPendingWritebackReports()).toEqual(
    new Map([
      ['job-1', 'sent'],
      ['job-2', 'sent'],
    ]),
  );
});

test('ignores malformed delivered write-back cache files', async () => {
  const configDir = await useTempConfigDir();
  await mkdir(configDir, { recursive: true });
  await writeFile(join(configDir, 'plannotator-writebacks-delivered.json'), 'not json', 'utf-8');

  expect(loadPendingWritebackReports()).toEqual(new Map());
});
