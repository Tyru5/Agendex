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
