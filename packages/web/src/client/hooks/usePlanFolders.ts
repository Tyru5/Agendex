import { useCallback, useMemo, useSyncExternalStore } from 'react';
import {
  type FolderState,
  generateId,
  getAncestorPath,
  getChildFolderIds,
  isDescendantOf,
  MAX_FOLDERS,
  type PlanFolder,
  type PlanFolderStore,
  parseStore,
} from '../lib/plan-folders.ts';

const STORAGE_KEY = 'agendex_plan_folders';

let cached: PlanFolderStore = (() => {
  try {
    return parseStore(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'));
  } catch {
    return parseStore(null);
  }
})();

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function snapshot() {
  return cached;
}

function write(next: PlanFolderStore) {
  cached = next;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  for (const cb of listeners) cb();
}

export function usePlanFolders(): FolderState {
  const store = useSyncExternalStore(subscribe, snapshot);

  const folders = useMemo(
    () => Object.values(store.folders).sort((a, b) => a.name.localeCompare(b.name)) as PlanFolder[],
    [store],
  );

  const folderCount = useMemo(() => Object.keys(store.folders).length, [store]);

  const getFolderForPlan = useCallback(
    (planId: string) => {
      const folderId = store.assignments[planId];
      if (!folderId) return null;
      if (!store.folders[folderId]) return null;
      return folderId;
    },
    [store],
  );

  const assignPlan = useCallback((planId: string, folderId: string | null) => {
    const current = snapshot();
    if (folderId === null) {
      if (!(planId in current.assignments)) return;
      const next = { ...current.assignments };
      delete next[planId];
      write({ ...current, assignments: next });
      return;
    }
    if (!current.folders[folderId]) return;
    if (current.assignments[planId] === folderId) return;
    write({ ...current, assignments: { ...current.assignments, [planId]: folderId } });
  }, []);

  const isExpanded = useCallback((folderId: string) => store.expanded[folderId] === true, [store]);

  const setExpanded = useCallback((folderId: string, expanded: boolean) => {
    const current = snapshot();
    if (current.expanded[folderId] === expanded) return;
    const next = { ...current.expanded };
    if (expanded) {
      next[folderId] = true;
    } else {
      delete next[folderId];
    }
    write({ ...current, expanded: next });
  }, []);

  const expandPathTo = useCallback((folderId: string | null) => {
    if (!folderId) return;
    const current = snapshot();
    const path = getAncestorPath(folderId, current.folders);
    if (path.length === 0) return;
    const nextExpanded = { ...current.expanded };
    let changed = false;
    for (const id of path) {
      if (!nextExpanded[id]) {
        nextExpanded[id] = true;
        changed = true;
      }
    }
    if (changed) write({ ...current, expanded: nextExpanded });
  }, []);

  const createFolder = useCallback((name: string, parentId: string | null = null) => {
    const trimmed = name.trim();
    if (!trimmed) return { ok: false as const, reason: 'invalid-name' as const };
    const current = snapshot();
    if (Object.keys(current.folders).length >= MAX_FOLDERS) {
      return { ok: false as const, reason: 'limit' as const };
    }
    if (parentId && !current.folders[parentId]) {
      return { ok: false as const, reason: 'invalid-parent' as const };
    }
    const id = generateId();
    const folder: PlanFolder = {
      id,
      name: trimmed,
      parentId,
      createdAt: new Date().toISOString(),
    };
    write({
      ...current,
      folders: { ...current.folders, [id]: folder },
      expanded: { ...current.expanded, [id]: true },
    });
    return { ok: true as const, id };
  }, []);

  const renameFolder = useCallback((folderId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return false;
    const current = snapshot();
    const folder = current.folders[folderId];
    if (!folder) return false;
    if (folder.name === trimmed) return false;
    write({
      ...current,
      folders: { ...current.folders, [folderId]: { ...folder, name: trimmed } },
    });
    return true;
  }, []);

  const moveFolder = useCallback((folderId: string, parentId: string | null) => {
    const current = snapshot();
    const folder = current.folders[folderId];
    if (!folder) return false;
    if (folder.parentId === parentId) return false;
    if (parentId === folderId) return false;
    if (parentId && !current.folders[parentId]) return false;
    if (parentId && isDescendantOf(parentId, folderId, current.folders)) return false;
    write({
      ...current,
      folders: { ...current.folders, [folderId]: { ...folder, parentId } },
    });
    return true;
  }, []);

  const deleteFolder = useCallback((folderId: string) => {
    const current = snapshot();
    if (!current.folders[folderId]) return;
    const descendants = getChildFolderIds(folderId, current.folders);
    const allIds = new Set([folderId, ...descendants]);

    const nextFolders = { ...current.folders };
    for (const id of allIds) delete nextFolders[id];

    const nextAssignments = { ...current.assignments };
    for (const [planId, assignedFolderId] of Object.entries(nextAssignments)) {
      if (allIds.has(assignedFolderId)) delete nextAssignments[planId];
    }

    const nextExpanded = { ...current.expanded };
    for (const id of allIds) delete nextExpanded[id];

    write({
      ...current,
      folders: nextFolders,
      assignments: nextAssignments,
      expanded: nextExpanded,
    });
  }, []);

  return {
    folders,
    getFolderForPlan,
    assignPlan,
    isExpanded,
    setExpanded,
    expandPathTo,
    createFolder,
    renameFolder,
    moveFolder,
    deleteFolder,
    folderCount,
  };
}
