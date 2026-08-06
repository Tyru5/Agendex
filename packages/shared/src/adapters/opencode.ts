import { join, resolve } from 'node:path';
import { getHomeDir } from '../home-dir.ts';
import {
  createStructuredSessionAdapter,
  type StructuredPlanCandidate,
} from './structured-session.ts';

interface OpenCodeRow {
  session_id: string;
  session_title: string;
  directory: string;
  session_created: number;
  session_updated: number;
  message_id: string;
  message_created: number;
  message_data: string;
  part_data: string;
}

interface MessageData {
  role?: unknown;
  agent?: unknown;
  mode?: unknown;
}

interface PartData {
  type?: unknown;
  text?: unknown;
  synthetic?: unknown;
  ignored?: unknown;
}

function dataDir(): string {
  const xdgData = process.env.XDG_DATA_HOME?.trim();
  return xdgData ? join(xdgData, 'opencode') : join(getHomeDir(), '.local', 'share', 'opencode');
}

function databasePath(): string {
  return join(dataDir(), 'opencode.db');
}

function parseObject(raw: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function toDate(value: number): Date | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return new Date(value);
}

async function decodeOpenCodeDatabase(filePath: string): Promise<StructuredPlanCandidate[]> {
  const query = `SELECT
          s.id AS session_id,
          s.title AS session_title,
          s.directory AS directory,
          s.time_created AS session_created,
          s.time_updated AS session_updated,
          m.id AS message_id,
          m.time_created AS message_created,
          m.data AS message_data,
          p.data AS part_data
        FROM session s
        JOIN message m ON m.session_id = s.id
        JOIN part p ON p.message_id = m.id
        ORDER BY s.time_updated ASC, m.time_created ASC, m.id ASC, p.id ASC`;
  let rows: OpenCodeRow[];
  if (typeof Bun !== 'undefined') {
    const { Database } = await import('bun:sqlite');
    const database = new Database(filePath, { readonly: true, create: false });
    try {
      rows = database.query(query).all() as OpenCodeRow[];
    } finally {
      database.close();
    }
  } else {
    const { default: Database } = await import('better-sqlite3');
    const database = new Database(filePath, { readonly: true, fileMustExist: true });
    try {
      rows = database.prepare(query).all() as OpenCodeRow[];
    } finally {
      database.close();
    }
  }

  {
    const sessions = new Map<
      string,
      {
        title: string;
        directory: string;
        createdAt?: Date;
        updatedAt?: Date;
        messages: Map<string, { created: number; texts: string[] }>;
      }
    >();

    for (const row of rows) {
      const message = parseObject(row.message_data) as MessageData | undefined;
      if (message?.role !== 'assistant' || (message.agent !== 'plan' && message.mode !== 'plan')) {
        continue;
      }
      const part = parseObject(row.part_data) as PartData | undefined;
      if (
        part?.type !== 'text' ||
        typeof part.text !== 'string' ||
        part.synthetic === true ||
        part.ignored === true
      ) {
        continue;
      }

      let session = sessions.get(row.session_id);
      if (!session) {
        session = {
          title: row.session_title || 'OpenCode Plan',
          directory: row.directory,
          createdAt: toDate(row.session_created),
          updatedAt: toDate(row.session_updated),
          messages: new Map(),
        };
        sessions.set(row.session_id, session);
      }
      const messageEntry = session.messages.get(row.message_id) ?? {
        created: row.message_created,
        texts: [],
      };
      messageEntry.texts.push(part.text);
      session.messages.set(row.message_id, messageEntry);
    }

    const candidates: StructuredPlanCandidate[] = [];
    for (const [sessionId, session] of sessions) {
      const messages = [...session.messages.values()].sort((a, b) => a.created - b.created);
      const latest = messages.at(-1);
      if (!latest) continue;
      candidates.push({
        key: sessionId,
        title: session.title,
        content: latest.texts.join('\n\n'),
        workspace: session.directory || undefined,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        metadata: {
          sessionId,
          planMessageCount: messages.length,
          planEvidence: 'assistant-agent-plan',
        },
      });
    }
    return candidates;
  }
}

export const openCodeAdapter = createStructuredSessionAdapter({
  agent: 'opencode',
  format: 'sqlite',
  getSearchPaths: () => [dataDir()],
  matches: (filePath) => {
    const db = resolve(databasePath());
    const resolved = resolve(filePath);
    return resolved === db || resolved === `${db}-wal` || resolved === `${db}-shm`;
  },
  resolveSourcePath: databasePath,
  decode: decodeOpenCodeDatabase,
});
