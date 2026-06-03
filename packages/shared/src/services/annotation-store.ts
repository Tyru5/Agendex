import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createPlanAnnotationRecord,
  type CreatePlanAnnotationInput,
  type PlanAnnotationRecord,
  type PlanAnnotationStatus,
} from '../annotations.ts';
import { getConfigDir } from '../config.ts';

interface AnnotationStoreFile {
  version: 1;
  annotationsByPlanId: Record<string, PlanAnnotationRecord[]>;
}

type StoreMutationResult<T> = {
  changed: boolean;
  value: T;
};

let mutationQueue: Promise<void> = Promise.resolve();

function storePath(): string {
  return join(getConfigDir(), 'plan-annotations.json');
}

async function loadStore(): Promise<AnnotationStoreFile> {
  const path = storePath();
  if (!existsSync(path)) return { version: 1, annotationsByPlanId: {} };

  try {
    const raw = await readFile(path, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AnnotationStoreFile>;
    return {
      version: 1,
      annotationsByPlanId: parsed.annotationsByPlanId ?? {},
    };
  } catch {
    return { version: 1, annotationsByPlanId: {} };
  }
}

async function saveStore(store: AnnotationStoreFile): Promise<void> {
  await mkdir(getConfigDir(), { recursive: true });
  const path = storePath();
  const tempPath = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(tempPath, JSON.stringify(store, null, 2), 'utf-8');
  await rename(tempPath, path);
}

async function mutateStore<T>(
  mutate: (store: AnnotationStoreFile) => StoreMutationResult<T> | Promise<StoreMutationResult<T>>,
): Promise<T> {
  const run = mutationQueue.then(async () => {
    const store = await loadStore();
    const result = await mutate(store);
    if (result.changed) await saveStore(store);
    return result.value;
  });

  mutationQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function readStore<T>(read: (store: AnnotationStoreFile) => T): Promise<T> {
  await mutationQueue;
  return read(await loadStore());
}

export async function listPlanAnnotations(planId: string): Promise<PlanAnnotationRecord[]> {
  return readStore((store) => store.annotationsByPlanId[planId] ?? []);
}

export async function createPlanAnnotation(
  planId: string,
  input: CreatePlanAnnotationInput,
): Promise<PlanAnnotationRecord> {
  return mutateStore((store) => {
    const annotation = {
      ...createPlanAnnotationRecord(input),
      planId,
    };
    store.annotationsByPlanId[planId] = [...(store.annotationsByPlanId[planId] ?? []), annotation];
    return { changed: true, value: annotation };
  });
}

export async function updatePlanAnnotationStatus({
  planId,
  annotationId,
  status,
  writebackId,
}: {
  planId: string;
  annotationId: string;
  status?: PlanAnnotationStatus;
  writebackId?: string;
}): Promise<PlanAnnotationRecord | null> {
  return mutateStore((store) => {
    const annotations = store.annotationsByPlanId[planId] ?? [];
    const index = annotations.findIndex((annotation) => annotation.id === annotationId);
    if (index === -1) return { changed: false, value: null };

    const existing = annotations[index];
    if (!existing) return { changed: false, value: null };

    const hasStatus = status !== undefined;
    const hasWritebackId = writebackId !== undefined;
    if (!hasStatus && !hasWritebackId) return { changed: false, value: existing };

    const now = Date.now();
    const nextStatus = status ?? existing.status;
    const updated: PlanAnnotationRecord = {
      ...existing,
      status: nextStatus,
      updatedAt: now,
      submittedAt: status === 'submitted' ? now : existing.submittedAt,
      resolvedAt: hasStatus ? (status === 'resolved' ? now : undefined) : existing.resolvedAt,
      writebackId: hasWritebackId ? writebackId : existing.writebackId,
    };
    annotations[index] = updated;
    store.annotationsByPlanId[planId] = annotations;
    return { changed: true, value: updated };
  });
}

export async function deletePlanAnnotation(planId: string, annotationId: string): Promise<boolean> {
  return mutateStore((store) => {
    const annotations = store.annotationsByPlanId[planId] ?? [];
    const updated = annotations.filter((annotation) => annotation.id !== annotationId);
    if (updated.length === annotations.length) return { changed: false, value: false };
    store.annotationsByPlanId[planId] = updated;
    return { changed: true, value: true };
  });
}
