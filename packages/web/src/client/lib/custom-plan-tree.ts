import type { Plan } from './api.ts';

export type FsTreeNode =
  | { type: 'dir'; key: string; name: string; children: FsTreeNode[] }
  | { type: 'file'; key: string; name: string; plan: Plan };

export function isCustomDirPlan(plan: Plan): boolean {
  return plan.metadata.source === 'custom-dir' || typeof plan.metadata.customDir === 'string';
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

function basename(p: string): string {
  const normalized = normalizePath(p);
  return normalized.split('/').pop() ?? normalized;
}

export function buildCustomDirTree(plans: Plan[]): FsTreeNode[] {
  const customPlans = plans.filter(
    (p) => p.metadata.source === 'custom-dir' && typeof p.metadata.customDir === 'string',
  );

  const byRoot = new Map<string, Plan[]>();
  for (const plan of customPlans) {
    const root = normalizePath(plan.metadata.customDir as string);
    const existing = byRoot.get(root);
    if (existing) {
      existing.push(plan);
    } else {
      byRoot.set(root, [plan]);
    }
  }

  const roots: FsTreeNode[] = [];

  for (const [root, rootPlans] of byRoot) {
    const dirNode: FsTreeNode = {
      type: 'dir',
      key: root,
      name: basename(root),
      children: [],
    };

    const dirMap = new Map<string, FsTreeNode & { type: 'dir' }>();
    dirMap.set('', dirNode as FsTreeNode & { type: 'dir' });

    for (const plan of rootPlans) {
      const fullPath = normalizePath(plan.filePath);
      const relative = fullPath.startsWith(`${root}/`) ? fullPath.slice(root.length + 1) : fullPath;

      const segments = relative.split('/');
      const fileName = segments.pop() ?? relative;

      // root dir always exists in map
      // oxlint-disable-next-line typescript/no-non-null-assertion
      let currentDir = dirMap.get('')!;
      let currentPath = '';

      for (const segment of segments) {
        currentPath = currentPath ? `${currentPath}/${segment}` : segment;
        let existing = dirMap.get(currentPath);
        if (!existing) {
          existing = {
            type: 'dir',
            key: `${root}/${currentPath}`,
            name: segment,
            children: [],
          };
          dirMap.set(currentPath, existing);
          currentDir.children.push(existing);
        }
        currentDir = existing;
      }

      currentDir.children.push({
        type: 'file',
        key: plan.id,
        name: fileName,
        plan,
      });
    }

    sortChildren(dirNode as FsTreeNode & { type: 'dir' });
    roots.push(dirNode);
  }

  return roots.sort((a, b) => a.name.localeCompare(b.name));
}

function sortChildren(node: FsTreeNode & { type: 'dir' }): void {
  node.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const child of node.children) {
    if (child.type === 'dir') {
      sortChildren(child);
    }
  }
}
