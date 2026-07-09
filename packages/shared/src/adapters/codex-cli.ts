import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { hashPath } from '../hash.ts';
import { assessPlanValue } from '../services/plan-value.ts';
import type { AgentAdapter, Plan } from '../types.ts';

const sessionsDir = join(homedir(), '.codex', 'sessions');
const PROPOSED_PLAN_BLOCK_REGEX = /<proposed_plan>\s*([\s\S]*?)\s*<\/proposed_plan>/gi;
const PROPOSED_PLAN_TAG_REGEX = /<\s*\/?\s*proposed_plan\s*>/gi;
const ESCAPED_PROPOSED_PLAN_TAG_REGEX = /&lt;\s*\/?\s*proposed_plan\s*&gt;/gi;

interface LegacySessionMeta {
  session_id?: string;
  started_at?: string;
}

interface NormalizedSessionMeta {
  sessionId?: string;
  startedAt?: string;
  cwd?: string;
}

interface NormalizedMessage {
  role: string;
  text: string;
  phase?: string;
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

function stripProposedPlanTags(text: string): string {
  return text.replace(ESCAPED_PROPOSED_PLAN_TAG_REGEX, '').replace(PROPOSED_PLAN_TAG_REGEX, '');
}

function normalizeMarkdown(text: string): string {
  return stripProposedPlanTags(normalizeLineEndings(text)).trim();
}

function parseJsonLines(raw: string): unknown[] {
  const parsed: unknown[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      parsed.push(JSON.parse(trimmed));
    } catch {
      // ignore malformed line
    }
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  const parts: string[] = [];
  for (const chunk of content) {
    if (!isRecord(chunk)) continue;
    const type = typeof chunk.type === 'string' ? chunk.type : '';
    if (type !== 'text' && type !== 'input_text' && type !== 'output_text') continue;
    if (typeof chunk.text === 'string') parts.push(chunk.text);
  }

  return parts.join('\n');
}

function extractSessionMeta(lines: unknown[]): NormalizedSessionMeta {
  const meta: NormalizedSessionMeta = {};

  for (const line of lines) {
    if (!isRecord(line)) continue;

    const legacyMeta = isRecord(line.session_meta)
      ? (line.session_meta as LegacySessionMeta)
      : undefined;

    if (legacyMeta?.session_id && !meta.sessionId) meta.sessionId = legacyMeta.session_id;
    if (legacyMeta?.started_at && !meta.startedAt) meta.startedAt = legacyMeta.started_at;

    if (line.type !== 'session_meta' || !isRecord(line.payload)) continue;

    if (typeof line.payload.id === 'string' && !meta.sessionId) {
      meta.sessionId = line.payload.id;
    }
    if (typeof line.payload.session_id === 'string' && !meta.sessionId) {
      meta.sessionId = line.payload.session_id;
    }
    if (typeof line.payload.timestamp === 'string' && !meta.startedAt) {
      meta.startedAt = line.payload.timestamp;
    }
    if (typeof line.payload.started_at === 'string' && !meta.startedAt) {
      meta.startedAt = line.payload.started_at;
    }
    if (typeof line.payload.cwd === 'string' && !meta.cwd) {
      meta.cwd = line.payload.cwd;
    }
  }

  return meta;
}

function normalizeRole(candidate: unknown, fallback = 'assistant'): string {
  if (typeof candidate !== 'string') return fallback;
  return candidate;
}

function extractMessages(lines: unknown[]): NormalizedMessage[] {
  const messages: NormalizedMessage[] = [];

  for (const line of lines) {
    if (!isRecord(line)) continue;

    if (
      line.type === 'response_item' &&
      isRecord(line.payload) &&
      line.payload.type === 'message'
    ) {
      const text = extractTextFromContent(line.payload.content);
      if (!text.trim()) continue;
      messages.push({
        role: normalizeRole(line.payload.role),
        text,
        phase: typeof line.payload.phase === 'string' ? line.payload.phase : undefined,
      });
      continue;
    }

    const hasLegacyFields =
      line.content !== undefined ||
      line.role !== undefined ||
      line.session_meta !== undefined ||
      line.type === 'message';

    if (!hasLegacyFields || line.session_meta !== undefined) continue;

    const text = extractTextFromContent(line.content);
    if (!text.trim()) continue;

    messages.push({
      role: normalizeRole(line.role, 'user'),
      text,
    });
  }

  return messages;
}

function extractProposedPlanBlocks(messages: NormalizedMessage[]): string[] {
  const blocks: string[] = [];

  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    const matches = message.text.matchAll(PROPOSED_PLAN_BLOCK_REGEX);
    for (const match of matches) {
      if (!match[1]) continue;
      const block = normalizeMarkdown(match[1]);
      if (block) blocks.push(block);
    }
  }

  return blocks;
}

function selectPlanContent(messages: NormalizedMessage[]): {
  content: string;
  planBlocks: string[];
} {
  const assistant = messages.filter((m) => m.role === 'assistant' && m.text.trim().length > 0);
  const planBlocks = extractProposedPlanBlocks(assistant);

  if (planBlocks.length > 0) {
    return {
      content: normalizeMarkdown(planBlocks.join('\n\n---\n\n')),
      planBlocks,
    };
  }

  const finalAnswerAssistant = assistant.filter((m) => m.phase === 'final_answer');
  const selected = finalAnswerAssistant.length > 0 ? finalAnswerAssistant : assistant;

  return {
    content: normalizeMarkdown(selected.map((m) => m.text).join('\n\n---\n\n')),
    planBlocks: [],
  };
}

function cleanTitle(title: string): string {
  return title
    .trim()
    .replace(/^Plan:\s*/i, '')
    .replace(/^#+\s*/, '')
    .replace(/^\*\*|\*\*$/g, '')
    .replace(/^`|`$/g, '')
    .replace(/^[-*+]\s+/, '')
    .trim();
}

function shorten(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1).trimEnd()}...`;
}

function titleFromPlanBlock(block: string): string | undefined {
  const heading = block.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/m)?.[1];
  if (heading) return cleanTitle(heading);

  const lines = block.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? '';
    const titleMatch = line.match(/^\*\*title\*\*(?::\s*(.+))?\s*$/i);
    if (!titleMatch) continue;

    if (titleMatch[1]?.trim()) return cleanTitle(titleMatch[1]);

    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j]?.trim() ?? '';
      if (!next) continue;
      return cleanTitle(next);
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || /^---+$/.test(trimmed)) continue;
    return cleanTitle(trimmed);
  }

  return undefined;
}

function isMeaningfulUserText(text: string): boolean {
  const normalized = normalizeLineEndings(text).trim();
  if (!normalized) return false;

  const lower = normalized.toLowerCase();
  if (lower.startsWith('# agents.md instructions')) return false;
  if (lower.startsWith('<environment_context>')) return false;
  if (lower.startsWith('<system-reminder>')) return false;

  return true;
}

function extractTitle(
  messages: NormalizedMessage[],
  planBlocks: string[],
  filename: string,
): string {
  if (planBlocks.length > 0 && planBlocks[0]) {
    const planTitle = titleFromPlanBlock(planBlocks[0]);
    if (planTitle) return shorten(planTitle, 120);
  }

  const firstUser = messages.find((m) => m.role === 'user' && isMeaningfulUserText(m.text));
  if (firstUser) {
    const firstLine = normalizeLineEndings(firstUser.text)
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean);
    if (firstLine) return shorten(cleanTitle(firstLine), 80);
  }

  return basename(filename, '.jsonl');
}

function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
}

export const codexCliAdapter: AgentAdapter = {
  agent: 'codex-cli',
  writable: false,

  getSearchPaths() {
    return [sessionsDir];
  },

  getWatchPaths() {
    return [sessionsDir];
  },

  matches(filePath: string) {
    return filePath.endsWith('.jsonl') && basename(filePath).startsWith('rollout-');
  },

  async parse(filePath: string): Promise<Plan[]> {
    try {
      const raw = await readFile(filePath, 'utf-8');
      const lines = parseJsonLines(raw);
      if (lines.length === 0) return [];

      const messages = extractMessages(lines);
      const { content, planBlocks } = selectPlanContent(messages);
      if (!content.trim()) return [];

      const stats = await stat(filePath);
      const sessionMeta = extractSessionMeta(lines);
      const createdAt = parseDate(sessionMeta.startedAt) ?? stats.birthtime;
      const title = extractTitle(messages, planBlocks, filePath);

      const metadata: Record<string, unknown> = {};
      if (sessionMeta.sessionId) metadata.sessionId = sessionMeta.sessionId;
      if (planBlocks.length > 0) metadata.planBlocks = planBlocks.length;

      // Prefer <proposed_plan> blocks, but older/differently formatted rollouts
      // may put a real markdown plan only in the final answer. Skip only when
      // that fallback is low-value (commit messages, reviews, harness runs) so
      // rescan does not delete previously indexed plans for the file.
      if (planBlocks.length === 0) {
        const assessment = assessPlanValue({ content, title, metadata });
        if (assessment.lowValue) return [];
      }

      return [
        {
          id: hashPath(filePath),
          agent: 'codex-cli',
          title,
          content,
          filePath,
          format: 'jsonl',
          createdAt,
          updatedAt: stats.mtime,
          workspace: sessionMeta.cwd,
          metadata,
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
