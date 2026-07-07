/// <reference types="node" />
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { hashPath } from '../hash.ts';
import type { AgentAdapter, Plan } from '../types.ts';

const continueDir = join(homedir(), '.continue', 'sessions');

interface SessionIndex {
  sessionId: string;
  title: string;
  dateCreated: string;
  workspaceDirectory?: string;
}

interface SessionFile {
  history?: Array<{
    role: string;
    content: string;
  }>;
}

export const continueIdeAdapter: AgentAdapter = {
  agent: 'continue-ide',
  writable: false,

  getSearchPaths() {
    return [continueDir];
  },

  getWatchPaths() {
    return [continueDir];
  },

  matches(filePath: string) {
    return filePath.endsWith('.json');
  },

  async parse(filePath: string): Promise<Plan[]> {
    try {
      const raw = await readFile(filePath, 'utf-8');
      const session: SessionFile = JSON.parse(raw);
      if (!session.history || session.history.length === 0) return [];

      const stats = await stat(filePath);

      let title = 'Continue Session';
      let workspace: string | undefined;
      const sessionId = filePath.split('/').pop()?.replace('.json', '');

      const indexPath = join(continueDir, 'sessions.json');
      try {
        const indexRaw = await readFile(indexPath, 'utf-8');
        const sessions: SessionIndex[] = JSON.parse(indexRaw);
        const meta = sessions.find((s) => s.sessionId === sessionId);
        if (meta) {
          title = meta.title || title;
          workspace = meta.workspaceDirectory;
        }
      } catch {
        // index not available
      }

      const content = (session.history ?? [])
        .map((m) => `**${m.role}**: ${m.content}`)
        .join('\n\n---\n\n');

      return [
        {
          id: hashPath(filePath),
          agent: 'continue-ide',
          title,
          content,
          filePath,
          format: 'json',
          createdAt: stats.birthtime,
          updatedAt: stats.mtime,
          workspace,
          metadata: sessionId ? { sessionId } : {},
        },
      ];
    } catch {
      return [];
    }
  },

  async write(): Promise<boolean> {
    return false;
  },
};
