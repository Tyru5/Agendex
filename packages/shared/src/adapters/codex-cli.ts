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
  /** Unique thread id for this rollout (payload.id). */
  sessionId?: string;
  /** Parent thread id when this rollout is a multi-agent child. */
  parentThreadId?: string;
  /** Codex thread_source: "user" | "subagent" | … */
  threadSource?: string;
  agentNickname?: string;
  agentRole?: string;
  startedAt?: string;
  cwd?: string;
  /** True when this rollout is a multi-agent subagent thread, not a user plan session. */
  isSubagent: boolean;
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

function isSubagentSource(source: unknown): boolean {
  if (source === 'subagent') return true;
  if (!isRecord(source)) return false;
  // Modern Codex: { subagent: { thread_spawn: { parent_thread_id, … } } }
  if (isRecord(source.subagent)) return true;
  if (source.type === 'subagent' || source.kind === 'subagent') return true;
  return false;
}

function extractSessionMeta(lines: unknown[]): NormalizedSessionMeta {
  const meta: NormalizedSessionMeta = { isSubagent: false };

  for (const line of lines) {
    if (!isRecord(line)) continue;

    const legacyMeta = isRecord(line.session_meta)
      ? (line.session_meta as LegacySessionMeta)
      : undefined;

    if (legacyMeta?.session_id && !meta.sessionId) meta.sessionId = legacyMeta.session_id;
    if (legacyMeta?.started_at && !meta.startedAt) meta.startedAt = legacyMeta.started_at;

    if (line.type !== 'session_meta' || !isRecord(line.payload)) continue;

    // Prefer the unique thread id (payload.id). For subagents, payload.session_id
    // is often the *parent* thread — useful for parentThreadId fallback, not as
    // this rollout's identity.
    if (typeof line.payload.id === 'string' && !meta.sessionId) {
      meta.sessionId = line.payload.id;
    }
    if (typeof line.payload.session_id === 'string') {
      if (!meta.sessionId) meta.sessionId = line.payload.session_id;
      // When id and session_id differ, session_id is the parent/root thread.
      if (
        typeof line.payload.id === 'string' &&
        line.payload.session_id !== line.payload.id &&
        !meta.parentThreadId
      ) {
        meta.parentThreadId = line.payload.session_id;
      }
    }
    if (typeof line.payload.parent_thread_id === 'string' && !meta.parentThreadId) {
      meta.parentThreadId = line.payload.parent_thread_id;
    }
    if (typeof line.payload.thread_source === 'string' && !meta.threadSource) {
      meta.threadSource = line.payload.thread_source;
    }
    if (typeof line.payload.agent_nickname === 'string' && !meta.agentNickname) {
      meta.agentNickname = line.payload.agent_nickname;
    }
    if (typeof line.payload.agent_role === 'string' && !meta.agentRole) {
      meta.agentRole = line.payload.agent_role;
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
    if (isSubagentSource(line.payload.source) || line.payload.thread_source === 'subagent') {
      meta.isSubagent = true;
    }
  }

  // Defensive: any child thread with a parent is a multi-agent spawn, even if
  // an older Codex build omitted thread_source / source.subagent.
  if (meta.parentThreadId && meta.sessionId && meta.parentThreadId !== meta.sessionId) {
    meta.isSubagent = true;
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

/**
 * Codex injects many non-prompt "user" envelopes (plugin catalogs, env context,
 * hooks, subagent notifications). These must not become plan titles or be
 * treated as the session intent.
 */
const USER_ENVELOPE_OPENERS = [
  /^#\s*agents\.md instructions\b/i,
  /^<environment_context\b/i,
  /^<system-reminder\b/i,
  /^<recommended_plugins\b/i,
  /^<user_action\b/i,
  /^<user_instructions\b/i,
  /^<user_prompt\b/i,
  /^<hook_prompt\b/i,
  /^<codex_internal_context\b/i,
  /^<subagent_notification\b/i,
  /^<skill\b/i,
  /^<instructions\b/i,
  /^<permissions(?:_|\s)?instructions\b/i,
  /^<multi_agent_mode\b/i,
  /^<collaboration_mode\b/i,
  /^<turn_aborted\b/i,
  /^<permissions\b/i,
  /^<image\b/i,
  /^files mentioned by the user:\s*$/i,
];

function isUserEnvelopeText(text: string): boolean {
  const normalized = normalizeLineEndings(text).trim();
  if (!normalized) return true;
  return USER_ENVELOPE_OPENERS.some((pattern) => pattern.test(normalized));
}

/** Prefer real user intent; strip a leading <task>… envelope when present. */
function titleFromUserText(text: string): string | undefined {
  let normalized = normalizeLineEndings(text).trim();
  if (!normalized || isUserEnvelopeText(normalized)) return undefined;

  // Unwrap <task>…</task> so the title is the inner prompt, not the tag.
  const taskMatch = normalized.match(/^<task\b[^>]*>([\s\S]*?)(?:<\/task>|$)/i);
  if (taskMatch?.[1]?.trim()) {
    normalized = taskMatch[1].trim();
  }

  const firstLine = normalized
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !isUserEnvelopeText(line));
  if (!firstLine) return undefined;

  // Still looks like an XML control tag — not a usable title.
  if (/^<\/?[a-z][\w:-]*(?:\s[^>]*)?>/i.test(firstLine) && firstLine.length < 80) {
    return undefined;
  }

  return shorten(cleanTitle(firstLine), 80);
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

  for (const message of messages) {
    if (message.role !== 'user') continue;
    const title = titleFromUserText(message.text);
    if (title) return title;
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

      // Multi-agent child threads get their own rollout files. They re-use the
      // parent prompt (and sometimes plan-like structure), which previously
      // flooded the index/cloud with near-duplicate "plans". Never index them.
      const sessionMeta = extractSessionMeta(lines);
      if (sessionMeta.isSubagent) return [];

      const messages = extractMessages(lines);
      const { content, planBlocks } = selectPlanContent(messages);
      if (!content.trim()) return [];

      const stats = await stat(filePath);
      const createdAt = parseDate(sessionMeta.startedAt) ?? stats.birthtime;
      const title = extractTitle(messages, planBlocks, filePath);

      const metadata: Record<string, unknown> = {};
      if (sessionMeta.sessionId) metadata.sessionId = sessionMeta.sessionId;
      if (sessionMeta.threadSource) metadata.threadSource = sessionMeta.threadSource;
      if (planBlocks.length > 0) metadata.planBlocks = planBlocks.length;

      // Prefer <proposed_plan> blocks. Older/differently formatted rollouts may
      // put a real markdown plan only in the final answer — keep those only when
      // they have explicit plan structure (sections/checklists), not mere
      // progress prose, ordered findings, or execution status dumps.
      if (planBlocks.length === 0) {
        const assessment = assessPlanValue({ content, title, metadata });
        if (assessment.lowValue) return [];

        const hasPlanStructure = assessment.signals.some(
          (signal) =>
            signal === 'checklist' ||
            signal === 'metadata:proposed-plan-block' ||
            signal.startsWith('section:'),
        );
        if (!hasPlanStructure) return [];
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
