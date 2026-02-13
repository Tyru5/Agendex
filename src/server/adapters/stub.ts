import type { AgentAdapter } from './types.ts';

export function createStubAdapter(
  agent: string,
  searchPaths: string[],
  matchExt: string,
): AgentAdapter {
  return {
    agent,
    writable: false,
    getSearchPaths: () => searchPaths,
    getWatchPaths: () => searchPaths,
    matches: (fp: string) => fp.endsWith(matchExt),
    parse: async () => [],
    write: async () => false,
  };
}
