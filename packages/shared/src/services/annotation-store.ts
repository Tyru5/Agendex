import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
  await writeFile(storePath(), JSON.stringify(store, null, 2), 'utf-8');
}

export async function listPlanAnnotations(planId: string): Promise<PlanAnnotationRecord[]> {
  const store = await loadStore();
  return store.annotationsByPlanId[planId] ?? [];
}

export async function createPlanAnnotation(
  planId: string,
  input: CreatePlanAnnotationInput,
): Promise<PlanAnnotationRecord> {
  const store = await loadStore();
  const annotation = {
    ...createPlanAnnotationRecord(input),
    planId,
  };
  store.annotationsByPlanId[planId] = [...(store.annotationsByPlanId[planId] ?? []), annotation];
  await saveStore(store);
  return annotation;
}

export async function updatePlanAnnotationStatus({
  planId,
  annotationId,
  status,
  writebackId,
}: {
  planId: string;
  annotationId: string;
  status: PlanAnnotationStatus;
  writebackId?: string;
}): Promise<PlanAnnotationRecord | null> {
  const store = await loadStore();
  const annotations = store.annotationsByPlanId[planId] ?? [];
  const index = annotations.findIndex((annotation) => annotation.id === annotationId);
  if (index === -1) return null;

  const existing = annotations[index];
  if (!existing) return null;

  const now = Date.now();
  const updated: PlanAnnotationRecord = {
    ...existing,
    status,
    updatedAt: now,
    submittedAt: status === 'submitted' ? now : existing.submittedAt,
    resolvedAt: status === 'resolved' ? now : existing.resolvedAt,
    writebackId: writebackId ?? existing.writebackId,
  };
  annotations[index] = updated;
  store.annotationsByPlanId[planId] = annotations;
  await saveStore(store);
  return updated;
}

export async function deletePlanAnnotation(planId: string, annotationId: string): Promise<boolean> {
  const store = await loadStore();
  const annotations = store.annotationsByPlanId[planId] ?? [];
  const updated = annotations.filter((annotation) => annotation.id !== annotationId);
  if (updated.length === annotations.length) return false;
  store.annotationsByPlanId[planId] = updated;
  await saveStore(store);
  return true;
}
