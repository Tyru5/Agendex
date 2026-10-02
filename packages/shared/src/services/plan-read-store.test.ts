import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_READ_SNAPSHOT_BYTES } from '../plan-read.ts';
import {
  clearPlanRead,
  MAX_READ_SNAPSHOTS,
  MAX_READ_STORE_BYTES,
  openPlanRead,
} from './plan-read-store.ts';
let directory: string;
const source = { id: 'plan', agent: 'omp', filePath: '/repo/plan.md', workspace: '/repo' };
const first = {
  ...source,
  title: 'Plan',
  content: 'Original steps',
  updatedAt: '2026-01-01T00:00:00Z',
};
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'agendex-read-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
test('returns previous content before advancing the durable boundary', async () => {
  expect(await openPlanRead(first, directory)).toEqual({ baseline: null, reason: 'first-read' });
  const next = { ...first, content: 'New steps', updatedAt: '2026-02-01T00:00:00Z' };
  expect((await openPlanRead(next, directory)).baseline?.content).toBe('Original steps');
  expect((await openPlanRead(next, directory)).baseline?.content).toBe('New steps');
});
test('metadata timestamps alone do not fabricate content changes', async () => {
  await openPlanRead(first, directory);
  const read = await openPlanRead({ ...first, updatedAt: '2026-02-01T00:00:00Z' }, directory);
  expect(read.baseline?.content).toBe(first.content);
});
test('identical IDs in different agents, paths, workspaces and stores remain isolated', async () => {
  await openPlanRead(first, directory);
  for (const override of [
    { agent: 'claude' },
    { filePath: '/repo/other.md' },
    { workspace: '/other' },
  ])
    expect((await openPlanRead({ ...first, ...override }, directory)).baseline).toBeNull();
  expect((await openPlanRead(first, join(directory, 'other-machine'))).baseline).toBeNull();
});
test('forget removes only the nominated source baseline', async () => {
  await openPlanRead(first, directory);
  await openPlanRead({ ...first, id: 'other' }, directory);
  await clearPlanRead(first, directory);
  expect((await openPlanRead(first, directory)).baseline).toBeNull();
  expect((await openPlanRead({ ...first, id: 'other' }, directory)).baseline?.content).toBe(
    first.content,
  );
});
test('large plans are explicit and remove older stale snapshots', async () => {
  await openPlanRead(first, directory);
  expect(
    await openPlanRead({ ...first, content: 'x'.repeat(MAX_READ_SNAPSHOT_BYTES) }, directory),
  ).toEqual({ baseline: null, reason: 'too-large' });
  expect((await openPlanRead(first, directory)).baseline).toBeNull();
});
test('malformed and evicted snapshots provide a new baseline instead of misleading diffs', async () => {
  await writeFile(join(directory, 'plan-read-snapshots.json'), '{broken');
  expect((await openPlanRead(first, directory)).baseline).toBeNull();
  for (let i = 0; i < MAX_READ_SNAPSHOTS + 1; i++)
    await openPlanRead({ ...first, id: `p-${i}` }, directory);
  const store = JSON.parse(await readFile(join(directory, 'plan-read-snapshots.json'), 'utf8'));
  expect(Object.keys(store.entries).length).toBe(MAX_READ_SNAPSHOTS);
  expect(Buffer.byteLength(JSON.stringify(store))).toBeLessThanOrEqual(MAX_READ_STORE_BYTES);
  expect((await openPlanRead(first, directory)).baseline).toBeNull();
  expect(
    (await openPlanRead({ ...first, id: `p-${MAX_READ_SNAPSHOTS}` }, directory)).baseline?.content,
  ).toBe(first.content);
});
test('concurrent reads serialize without losing remembered revisions', async () => {
  await openPlanRead(first, directory);
  const reads = await Promise.all(
    ['one', 'two', 'three'].map((content) => openPlanRead({ ...first, content }, directory)),
  );
  const previous = reads.map((read) => read.baseline?.content);
  expect(new Set(previous).size).toBe(3);
  expect(previous).toContain('Original steps');
});

test('the total content budget evicts oldest reads before exhausting disk', async () => {
  const content = 'x'.repeat(235_000);
  for (let i = 0; i < 36; i++)
    await openPlanRead({ ...first, id: `large-${i}`, content }, directory);
  const raw = await readFile(join(directory, 'plan-read-snapshots.json'), 'utf8');
  expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(MAX_READ_STORE_BYTES);
  expect(Object.keys(JSON.parse(raw).entries).length).toBeLessThan(36);
  expect((await openPlanRead({ ...first, id: 'large-0', content }, directory)).baseline).toBeNull();
  expect(
    (await openPlanRead({ ...first, id: 'large-35', content }, directory)).baseline?.content,
  ).toBe(content);
});

test('JSON null and non-object stores recover for both open and forget', async () => {
  for (const invalid of ['null', '[]', '"broken"', '{"version":1,"entries":[]}']) {
    await writeFile(join(directory, 'plan-read-snapshots.json'), invalid);
    expect(await openPlanRead(first, directory)).toEqual({ baseline: null, reason: 'first-read' });
    await writeFile(join(directory, 'plan-read-snapshots.json'), invalid);
    await clearPlanRead(first, directory);
    expect((await openPlanRead(first, directory)).baseline).toBeNull();
  }
});
