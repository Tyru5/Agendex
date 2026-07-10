import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { hashPath } from '../hash.ts';
import type { AgentAdapter, Plan } from '../types.ts';

export interface StructuredPlanCandidate {
  key: string;
  title: string;
  content: string;
  workspace?: string;
  createdAt?: Date;
  updatedAt?: Date;
  metadata: Record<string, unknown>;
}

export interface StructuredSessionAdapterOptions {
  agent: string;
  format: 'json' | 'jsonl' | 'sqlite';
  getSearchPaths: () => string[];
  matches: (filePath: string) => boolean;
  resolveSourcePath?: (filePath: string) => string;
  decode: (filePath: string) => Promise<StructuredPlanCandidate[]>;
}

export function createStructuredSessionAdapter(
  options: StructuredSessionAdapterOptions,
): AgentAdapter {
  return {
    agent: options.agent,
    writable: false,

    getSearchPaths() {
      return Array.from(new Set(options.getSearchPaths()));
    },

    getWatchPaths() {
      return Array.from(new Set(options.getSearchPaths()));
    },

    matches(filePath: string) {
      return options.matches(filePath);
    },

    async parse(filePath: string): Promise<Plan[]> {
      if (!options.matches(filePath)) return [];
      try {
        const sourcePath = options.resolveSourcePath?.(filePath) ?? filePath;
        const [stats, candidates] = await Promise.all([
          stat(sourcePath),
          options.decode(sourcePath),
        ]);
        return candidates
          .filter((candidate) => candidate.content.trim())
          .map((candidate) => ({
            id: hashPath(`${sourcePath}#${candidate.key}`),
            agent: options.agent,
            title: candidate.title,
            content: candidate.content.trim(),
            filePath: sourcePath,
            format: options.format,
            createdAt: candidate.createdAt ?? stats.birthtime,
            updatedAt: candidate.updatedAt ?? stats.mtime,
            workspace: candidate.workspace,
            metadata: {
              source: 'structured-session',
              sourcePaths: [sourcePath],
              evidence: 'explicit-plan-state',
              revision: createHash('sha256').update(candidate.content.trim()).digest('hex'),
              ...candidate.metadata,
            },
          }));
      } catch {
        return [];
      }
    },

    async write(): Promise<boolean> {
      return false;
    },
  };
}
