import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createPlanAnnotation,
  listPlanAnnotations,
  updatePlanAnnotationStatus,
} from './annotation-store.ts';

const originalConfigDir = process.env.AGENDEX_CONFIG_DIR;
let tempRoot: string | undefined;

async function useTempConfigDir(): Promise<void> {
  tempRoot = await mkdtemp(join(tmpdir(), 'agendex-annotations-'));
  process.env.AGENDEX_CONFIG_DIR = join(tempRoot, '.agendex-test');
}

afterEach(async () => {
  if (originalConfigDir === undefined) delete process.env.AGENDEX_CONFIG_DIR;
  else process.env.AGENDEX_CONFIG_DIR = originalConfigDir;

  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

test('concurrent annotation creates do not overwrite each other', async () => {
  await useTempConfigDir();

  await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      createPlanAnnotation('plan-1', {
        type: 'comment',
        body: `Comment ${index}`,
        anchor: { quote: `Quote ${index}` },
      }),
    ),
  );

  const annotations = await listPlanAnnotations('plan-1');

  expect(annotations).toHaveLength(20);
  expect(new Set(annotations.map((annotation) => annotation.body)).size).toBe(20);
});

test('annotation list reads wait for queued creates', async () => {
  await useTempConfigDir();

  const createPromise = createPlanAnnotation('plan-1', {
    type: 'comment',
    body: 'Queued write',
    anchor: { quote: 'Queued' },
  });

  const annotations = await listPlanAnnotations('plan-1');
  const created = await createPromise;

  expect(annotations.map((annotation) => annotation.id)).toContain(created.id);
});

test('annotation updates allow writeback without status', async () => {
  await useTempConfigDir();

  const annotation = await createPlanAnnotation('plan-1', {
    type: 'comment',
    body: 'Needs tests',
    anchor: { quote: 'Tests' },
  });

  const updated = await updatePlanAnnotationStatus({
    planId: 'plan-1',
    annotationId: annotation.id,
    writebackId: 'writeback-1',
  });

  expect(updated).toMatchObject({
    id: annotation.id,
    status: 'open',
    writebackId: 'writeback-1',
  });
});

test('reopened annotations clear resolvedAt in the local store', async () => {
  await useTempConfigDir();

  const annotation = await createPlanAnnotation('plan-1', {
    type: 'comment',
    body: 'Needs tests',
    anchor: { quote: 'Tests' },
  });
  const resolved = await updatePlanAnnotationStatus({
    planId: 'plan-1',
    annotationId: annotation.id,
    status: 'resolved',
  });

  expect(resolved?.resolvedAt).toBeNumber();

  const reopened = await updatePlanAnnotationStatus({
    planId: 'plan-1',
    annotationId: annotation.id,
    status: 'open',
  });

  expect(reopened?.status).toBe('open');
  expect(reopened?.resolvedAt).toBeUndefined();
});
