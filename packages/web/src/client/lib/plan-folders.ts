export type PlanFolder = {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
};

export type PlanFolderStore = {
  version: 1;
  folders: Record<string, PlanFolder>;
  assignments: Record<string, string>; // planId -> folderId
  expanded: Record<string, boolean>; // folderId -> expanded
};

export type FolderState = {
  folders: PlanFolder[];
  getFolderForPlan: (planId: string) => string | null;
  assignPlan: (planId: string, folderId: string | null) => void;
  isExpanded: (folderId: string) => boolean;
  setExpanded: (folderId: string, expanded: boolean) => void;
  expandPathTo: (folderId: string | null) => void;
  createFolder: (
    name: string,
    parentId?: string | null,
  ) =>
    | { ok: true; id: string }
    | { ok: false; reason: 'limit' | 'invalid-parent' | 'invalid-name' };
  renameFolder: (folderId: string, name: string) => boolean;
  moveFolder: (folderId: string, parentId: string | null) => boolean;
  deleteFolder: (folderId: string) => void;
  folderCount: number;
};

export const MAX_FOLDERS = 10;

function generateId(): string {
  return `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function emptyStore(): PlanFolderStore {
  return { version: 1, folders: {}, assignments: {}, expanded: {} };
}

export function parseStore(raw: unknown): PlanFolderStore {
  if (!raw || typeof raw !== 'object') return emptyStore();
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1) return emptyStore();
  return {
    version: 1,
    folders: (typeof obj.folders === 'object' && obj.folders !== null ? obj.folders : {}) as Record<
      string,
      PlanFolder
    >,
    assignments: (typeof obj.assignments === 'object' && obj.assignments !== null
      ? obj.assignments
      : {}) as Record<string, string>,
    expanded: (typeof obj.expanded === 'object' && obj.expanded !== null
      ? obj.expanded
      : {}) as Record<string, boolean>,
  };
}

export function getChildFolderIds(folderId: string, folders: Record<string, PlanFolder>): string[] {
  const result: string[] = [];
  const stack = [folderId];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const [id, folder] of Object.entries(folders)) {
      if (folder.parentId === current && !visited.has(id)) {
        result.push(id);
        stack.push(id);
      }
    }
  }
  return result;
}

export function isDescendantOf(
  candidateId: string,
  ancestorId: string,
  folders: Record<string, PlanFolder>,
): boolean {
  const visited = new Set<string>();
  let current = candidateId;
  while (current) {
    if (visited.has(current)) return false;
    visited.add(current);
    const folder = folders[current];
    if (!folder?.parentId) return false;
    if (folder.parentId === ancestorId) return true;
    current = folder.parentId;
  }
  return false;
}

export function getRootFolders(folders: Record<string, PlanFolder>): PlanFolder[] {
  return Object.values(folders)
    .filter((f) => !f.parentId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getChildFolders(
  parentId: string,
  folders: Record<string, PlanFolder>,
): PlanFolder[] {
  return Object.values(folders)
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getAncestorPath(
  folderId: string | null,
  folders: Record<string, PlanFolder>,
): string[] {
  if (!folderId) return [];
  const path: string[] = [];
  const visited = new Set<string>();
  let current = folderId;
  while (current && folders[current]) {
    if (visited.has(current)) break;
    visited.add(current);
    path.unshift(current);
    const parentId = folders[current]?.parentId;
    if (!parentId) break;
    current = parentId;
  }
  return path;
}

export { generateId as _generateId, emptyStore as _emptyStore };
