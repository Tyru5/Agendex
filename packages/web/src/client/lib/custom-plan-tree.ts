import type { Plan } from './api.ts';

type FsDirectoryNode = {
  readonly type: 'dir';
  readonly key: string;
  readonly name: string;
  readonly children: FsTreeNode[];
};

type FsFileNode = {
  readonly type: 'file';
  readonly key: string;
  readonly name: string;
  readonly plan: Plan;
};

export type FsTreeNode = FsDirectoryNode | FsFileNode;

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

/**
 * Build a filesystem tree of custom-dir plans grouped by their source root.
 * When `extraSources` is provided, roots with no plans are still included
 * so the UI can render (and allow removal of) empty or file-path sources.
 */
export function buildCustomDirTree(
  plans: readonly Plan[],
  extraSources?: readonly string[],
): FsTreeNode[] {
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

  // Ensure every configured source appears in the tree even if it has no plans
  // (e.g. the path points to a file, the directory is empty, or it was deleted).
  if (extraSources) {
    for (const src of extraSources) {
      const key = normalizePath(src);
      if (!byRoot.has(key)) byRoot.set(key, []);
    }
  }

  const roots: FsTreeNode[] = [];

  for (const [root, rootPlans] of byRoot) {
    const dirNode: FsDirectoryNode = {
      type: 'dir',
      key: root,
      name: basename(root),
      children: [],
    };

    const dirMap = new Map<string, FsDirectoryNode>([['', dirNode]]);

    for (const plan of rootPlans) {
      const fullPath = normalizePath(plan.filePath);
      const relative = fullPath.startsWith(`${root}/`) ? fullPath.slice(root.length + 1) : fullPath;

      const segments = relative.split('/');
      const fileName = segments.pop() ?? relative;

      let currentDir = dirNode;
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

    sortChildren(dirNode);
    roots.push(dirNode);
  }

  return roots.sort((a, b) => a.name.localeCompare(b.name));
}

function sortChildren(node: FsDirectoryNode): void {
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
