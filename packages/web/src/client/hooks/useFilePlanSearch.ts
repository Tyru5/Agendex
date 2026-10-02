import { loadFilePlanMatches } from '../lib/file-plan-loader.ts';
import { useEffect, useMemo, useState } from 'react';
import { api, type Plan } from '../lib/api.ts';
import { parseFilePlanQuery } from '../lib/file-plan-query.ts';

const EMPTY_IDS: ReadonlySet<string> = new Set();

export function useFilePlanSearch(
  plans: readonly Plan[],
  query: string,
  workspace?: string,
  enabled = true,
) {
  const parsed = useMemo(() => parseFilePlanQuery(query), [query]);
  const key = JSON.stringify([
    parsed.files,
    workspace,
    plans.map((plan) => [plan.id, plan.updatedAt]),
  ]);
  const [state, setState] = useState<{
    key: string;
    ids: ReadonlySet<string>;
    error: string | null;
  }>();
  const hasFiles = parsed.files.length > 0 || Boolean(parsed.error);
  const inputError =
    parsed.error ??
    (hasFiles && !enabled
      ? 'File lookup is available in the local workspace. Switch to local mode to search files.'
      : null);

  useEffect(() => {
    if (!enabled || !parsed.files.length || parsed.error) return;
    const controller = new AbortController();
    // Debounce typing; paged responses never silently discard matches after the first 100.
    const timer = window.setTimeout(() => {
      void loadFilePlanMatches(
        parsed.files,
        (path, offset, signal) =>
          api.getFilePlanHistory(path, {
            workspace,
            allWorkspaces: !workspace,
            offset,
            signal,
          }),
        controller.signal,
      )
        .then((ids) => {
          if (!controller.signal.aborted) setState({ key, ids, error: null });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setState({
            key,
            ids: EMPTY_IDS,
            error: error instanceof Error ? error.message : 'File lookup failed.',
          });
        });
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, key, parsed.error, parsed.files, workspace]);

  const current = state?.key === key ? state : undefined;
  return {
    ids: hasFiles ? (inputError ? EMPTY_IDS : (current?.ids ?? EMPTY_IDS)) : undefined,
    loading: hasFiles && !inputError && !current,
    error: inputError ?? (hasFiles ? (current?.error ?? null) : null),
  };
}
