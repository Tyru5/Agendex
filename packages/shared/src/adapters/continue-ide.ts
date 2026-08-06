/// <reference types="node" />
import { readFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { getHomeDir } from '../config.ts';
import {
  createStructuredSessionAdapter,
  type StructuredPlanCandidate,
} from './structured-session.ts';

interface SessionIndex {
  sessionId?: unknown;
  title?: unknown;
  dateCreated?: unknown;
  workspaceDirectory?: unknown;
}

interface SessionFile {
  plan?: unknown;
  planContent?: unknown;
  history?: unknown;
}

function continueDir(): string {
  return join(getHomeDir(), '.continue', 'sessions');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function nestedString(record: Record<string, unknown>, keys: string[]): string | undefined {
  let value: unknown = record;
  for (const key of keys) {
    if (!isRecord(value)) return undefined;
    value = value[key];
  }
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function messageContent(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!Array.isArray(value)) return undefined;
  const parts = value
    .filter(isRecord)
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string);
  return parts.length > 0 ? parts.join('\n\n').trim() : undefined;
}

function explicitPlanMessage(entry: unknown): string | undefined {
  if (!isRecord(entry)) return undefined;
  const message = isRecord(entry.message) ? entry.message : entry;
  const role = nestedString(message, ['role']) ?? nestedString(entry, ['role']);
  if (role !== 'assistant') return undefined;

  const mode =
    nestedString(entry, ['mode']) ??
    nestedString(message, ['mode']) ??
    nestedString(entry, ['context', 'mode']) ??
    nestedString(entry, ['editorState', 'mode']);
  const agent = nestedString(entry, ['agent']) ?? nestedString(message, ['agent']);
  if (mode !== 'plan' && agent !== 'plan') return undefined;

  return messageContent(message.content);
}

async function sessionMetadata(sessionId: string): Promise<{
  title: string;
  workspace?: string;
  createdAt?: Date;
}> {
  try {
    const raw = await readFile(join(continueDir(), 'sessions.json'), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { title: 'Continue Plan' };
    const match = (parsed as SessionIndex[]).find((entry) => entry.sessionId === sessionId);
    if (!match) return { title: 'Continue Plan' };
    const created = typeof match.dateCreated === 'string' ? new Date(match.dateCreated) : undefined;
    return {
      title: typeof match.title === 'string' && match.title.trim() ? match.title : 'Continue Plan',
      workspace:
        typeof match.workspaceDirectory === 'string' ? match.workspaceDirectory : undefined,
      createdAt: created && !Number.isNaN(created.getTime()) ? created : undefined,
    };
  } catch {
    return { title: 'Continue Plan' };
  }
}

async function decodeContinueSession(filePath: string): Promise<StructuredPlanCandidate[]> {
  const raw = await readFile(filePath, 'utf-8');
  const session: SessionFile = JSON.parse(raw);
  const sessionId = basename(filePath, '.json');
  const metadata = await sessionMetadata(sessionId);

  const directPlan =
    messageContent(session.plan) ??
    messageContent(session.planContent) ??
    (isRecord(session.plan) ? messageContent(session.plan.content) : undefined);
  const history = Array.isArray(session.history) ? session.history : [];
  const planMessages = history
    .map(explicitPlanMessage)
    .filter((value): value is string => Boolean(value));
  const content = directPlan ?? planMessages.at(-1);
  if (!content) return [];

  return [
    {
      key: sessionId,
      title: metadata.title,
      content,
      workspace: metadata.workspace,
      createdAt: metadata.createdAt,
      metadata: {
        sessionId,
        planEvidence: directPlan ? 'plan-field' : 'assistant-plan-mode',
        planRevisionCount: directPlan ? 1 : planMessages.length,
      },
    },
  ];
}

export const continueIdeAdapter = createStructuredSessionAdapter({
  agent: 'continue-ide',
  format: 'json',
  getSearchPaths: () => [continueDir()],
  matches: (filePath) =>
    filePath.endsWith('.json') &&
    basename(filePath) !== 'sessions.json' &&
    resolve(filePath).startsWith(resolve(continueDir()) + sep),
  decode: decodeContinueSession,
});
