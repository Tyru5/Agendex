import type { Plan } from '@agendex/web';

export interface CloudCustomPlanSource {
  readonly path: string;
  readonly label: string;
  readonly plans: readonly Plan[];
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

function basename(value: string): string {
  const normalized = normalizePath(value);
  return normalized.split('/').pop() ?? normalized;
}

/**
 * Finds the synced cloud source matching `path`, tolerating separator and
 * trailing-slash differences (e.g. Windows `C:\dir\` vs the tree key `C:/dir`).
 */
export function findCloudCustomPlanSource(
  plans: readonly Plan[],
  path: string,
): CloudCustomPlanSource | undefined {
  const target = normalizePath(path);
  if (!target) return undefined;
  return getCloudCustomPlanSources(plans).find((source) => source.path === target);
}

/**
 * Whether `path` refers to one of the locally configured custom plan dirs.
 * Comparison is separator-insensitive so cloud-derived keys match raw
 * Windows paths stored in the local daemon config.
 */
export function isConfiguredPlanSourcePath(
  customPlanDirs: readonly string[],
  path: string,
): boolean {
  const target = normalizePath(path);
  if (!target) return false;
  return customPlanDirs.some((dir) => normalizePath(dir) === target);
}

const DELETE_BATCH_SIZE = 5;

/** Deletes cloud plan rows in small batches so large sources do not fan out at once. */
export async function deletePlansInBatches(
  planIds: readonly string[],
  deletePlan: (planId: string) => Promise<void>,
  onProgress?: () => void,
): Promise<void> {
  for (let start = 0; start < planIds.length; start += DELETE_BATCH_SIZE) {
    const batch = planIds.slice(start, start + DELETE_BATCH_SIZE);
    await Promise.all(
      batch.map(async (planId) => {
        await deletePlan(planId);
        onProgress?.();
      }),
    );
  }
}

export function getCloudCustomPlanSources(
  plans: readonly Plan[],
): readonly CloudCustomPlanSource[] {
  const byPath = new Map<string, Plan[]>();

  for (const plan of plans) {
    const customDir = plan.metadata.customDir;
    if (plan.metadata.source !== 'custom-dir' || typeof customDir !== 'string') continue;

    const path = normalizePath(customDir);
    if (!path) continue;

    const existing = byPath.get(path);
    if (existing) {
      existing.push(plan);
    } else {
      byPath.set(path, [plan]);
    }
  }

  return [...byPath.entries()]
    .map(([path, sourcePlans]) => ({
      path,
      label: basename(path),
      plans: sourcePlans,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
