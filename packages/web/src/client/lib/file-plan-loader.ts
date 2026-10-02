import type { FilePlanHistory } from '@agendex/shared/file-plan-history';

/** Walk every local page, intersect file filters, and stop promptly when superseded. */
export async function loadFilePlanMatches(
  files: readonly string[],
  load: (path: string, offset: number, signal: AbortSignal) => Promise<FilePlanHistory>,
  signal: AbortSignal,
): Promise<ReadonlySet<string>> {
  const sets: Set<string>[] = [];
  for (const path of files) {
    const ids = new Set<string>();
    let offset = 0;
    for (;;) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const result = await load(path, offset, signal);
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      result.plans.forEach((plan) => ids.add(plan.id));
      offset += result.plans.length;
      if (offset >= result.total) break;
      if (!result.plans.length)
        throw new Error('File lookup returned an incomplete page. Please retry.');
    }
    sets.push(ids);
  }
  return new Set([...(sets[0] ?? [])].filter((id) => sets.every((set) => set.has(id))));
}
