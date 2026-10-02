import { filePlanQueryPath } from '../lib/file-plan-path.ts';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { candidatePathsForValidation, extractCandidateCodePaths } from '@agendex/shared/plan-paths';
import { api, type Plan } from '../lib/api.ts';

export interface FilePlanCount {
  path: string;
  count: number;
  exact: boolean;
}
export interface FilePlanLookup {
  revision?: string;
  counts: (
    paths: string[],
    workspace: string | undefined,
    signal: AbortSignal,
  ) => Promise<FilePlanCount[]>;
  navigate: (path: string, workspace?: string) => void;
}
export const localFilePlanCounts: FilePlanLookup['counts'] = async (paths, workspace, signal) =>
  (await api.getFilePlanCounts(paths, workspace, signal)).counts;
export const FilePlanLookupContext = createContext<FilePlanLookup | null>(null);
export const FilePlanCountsContext = createContext<{
  counts: Record<string, FilePlanCount>;
  navigate: (path: string) => void;
} | null>(null);

/** One bounded batch per 20 paths, never a request per rendered path link. */
export function useFilePlanCounts(
  plan: Pick<Plan, 'id' | 'workspace' | 'filePath' | 'updatedAt'>,
  content: string,
) {
  const lookup = useContext(FilePlanLookupContext);
  const paths = useMemo(
    () => candidatePathsForValidation(extractCandidateCodePaths(content)),
    [content],
  );
  const targets = useMemo(
    () => Object.fromEntries(paths.map((path) => [path, filePlanQueryPath(path, plan)])),
    [paths, plan.filePath, plan.workspace],
  );
  const queryPaths = useMemo(() => [...new Set(Object.values(targets))], [targets]);
  const key = JSON.stringify([plan.id, plan.workspace, plan.updatedAt, targets, lookup?.revision]);
  const [state, setState] = useState<{ key: string; counts: Record<string, FilePlanCount> }>();
  useEffect(() => {
    if (!lookup || !paths.length) return;
    const controller = new AbortController();
    void (async () => {
      const counts: Record<string, FilePlanCount> = {};
      // Sequential batches bound both server work and concurrent requests for long plans.
      for (let offset = 0; offset < queryPaths.length; offset += 20) {
        const response = await lookup.counts(
          queryPaths.slice(offset, offset + 20),
          plan.workspace,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        response.forEach((count) => {
          counts[count.path] = count;
        });
      }
      const byMention: Record<string, FilePlanCount> = {};
      for (const [mention, target] of Object.entries(targets)) {
        const count = counts[target];
        if (count) byMention[mention] = { ...count, path: mention };
      }
      setState({ key, counts: byMention });
    })().catch(() => {
      /* Failed counts must not imply zero related plans. */
    });
    return () => controller.abort();
  }, [key, lookup, paths, plan.workspace, queryPaths, targets]);
  return useMemo(
    () =>
      lookup
        ? {
            counts: state?.key === key ? state.counts : {},
            navigate: (path: string) => lookup.navigate(targets[path] ?? path, plan.workspace),
          }
        : null,
    [key, lookup, plan.workspace, state, targets],
  );
}
