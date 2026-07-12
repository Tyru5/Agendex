import type { Plan } from '../types.ts';

export type PlanLowValueReason =
  | 'empty-content'
  | 'heading-only'
  | 'prompt-like'
  | 'system-context'
  | 'execution-report'
  | 'progress-narrative'
  | 'review-output'
  | 'wrapper-title'
  | 'tool-log'
  | 'conversation-artifact'
  | 'code-only'
  | 'code-dominated'
  | 'commit-message'
  | 'no-plan-signals';

export interface PlanValueAssessment {
  lowValue: boolean;
  reasons: PlanLowValueReason[];
  signals: string[];
}

export interface AssessPlanValueInput {
  content: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface PlanVisibilityInput {
  metadata?: unknown;
}

export function isLowValuePlan(plan: PlanVisibilityInput): boolean {
  const metadata = plan.metadata;
  return (
    typeof metadata === 'object' &&
    metadata !== null &&
    !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>).lowValue === true
  );
}

export function isIndexablePlan(plan: PlanVisibilityInput): boolean {
  return !isLowValuePlan(plan);
}

const PROPOSED_PLAN_TAG_REGEX = /<\s*\/?\s*proposed_plan\s*>/gi;
const ESCAPED_PROPOSED_PLAN_TAG_REGEX = /&lt;\s*\/?\s*proposed_plan\s*&gt;/gi;
const FENCED_CODE_BLOCK_REGEX = /(?:```|~~~)[\s\S]*?(?:```|~~~)/g;
const VISIBLE_TEXT_REGEX = /[\p{L}\p{N}]/u;

const LOW_VALUE_METADATA_KEYS = ['lowValue', 'lowValueReasons', 'lowValueSignals'] as const;

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

function stripBoundaryHtmlComments(text: string): string {
  let next = text;
  let previous = '';

  while (next !== previous) {
    previous = next;
    next = next.replace(/^\s*<!--[\s\S]*?-->\s*/, '').replace(/\s*<!--[\s\S]*?-->\s*$/, '');
  }

  return next;
}

function normalizePlanContent(content: string): string {
  return stripBoundaryHtmlComments(
    normalizeLineEndings(content)
      .replace(/^\uFEFF/, '')
      .replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '')
      .replace(ESCAPED_PROPOSED_PLAN_TAG_REGEX, '')
      .replace(PROPOSED_PLAN_TAG_REGEX, ''),
  ).trim();
}

function withoutLowValueMetadata(metadata: Record<string, unknown> | undefined) {
  const next = { ...metadata };
  for (const key of LOW_VALUE_METADATA_KEYS) delete next[key];
  return next;
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function visibleText(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '')
    .replace(ESCAPED_PROPOSED_PLAN_TAG_REGEX, '')
    .replace(PROPOSED_PLAN_TAG_REGEX, '')
    .replace(/[`*_#[\](){}<>:|~\-+=.]/g, ' ')
    .trim();
}

function stripFencedCodeBlocks(text: string): string {
  return text.replace(FENCED_CODE_BLOCK_REGEX, ' ');
}

function wordCount(text: string): number {
  return text.match(/[\p{L}\p{N}_]+/gu)?.length ?? 0;
}

interface CodeBlockMetrics {
  codeBlockCount: number;
  codeCharCount: number;
  codeShare: number;
  nonCodeWordCount: number;
}

function codeBlockMetrics(text: string): CodeBlockMetrics {
  const blocks = text.match(FENCED_CODE_BLOCK_REGEX) ?? [];
  const codeCharCount = blocks.reduce((sum, block) => sum + block.length, 0);
  const nonCode = stripFencedCodeBlocks(text);
  return {
    codeBlockCount: blocks.length,
    codeCharCount,
    codeShare: codeCharCount / Math.max(text.length, 1),
    nonCodeWordCount: wordCount(visibleText(nonCode)),
  };
}

function isSeparatorLine(line: string): boolean {
  return /^(?:-{3,}|_{3,}|\*{3,})$/.test(line.trim());
}

function isFenceLine(line: string): boolean {
  return /^(?:`{3,}|~{3,})/.test(line.trim());
}

function meaningfulLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !isSeparatorLine(line) && !isFenceLine(line));
}

function cleanMarkdownLine(line: string): string {
  return line
    .trim()
    .replace(/^>+\s*/, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/^\[[ xX]\]\s+/, '')
    .replace(/^\*\*|\*\*$/g, '')
    .replace(/^`|`$/g, '')
    .trim();
}

function isHeadingLine(line: string): boolean {
  return /^#{1,6}\s+\S/.test(line.trim());
}

function isChecklistLine(line: string): boolean {
  return /^[-*+]\s+\[[ xX]\]\s+\S/.test(line.trim());
}

function isOrderedListLine(line: string): boolean {
  return /^\d+[.)]\s+\S/.test(line.trim());
}

function isHeadingOnly(lines: string[]): boolean {
  return lines.some(isHeadingLine) && lines.every(isHeadingLine);
}

function metadataHasPlanBlocks(metadata: Record<string, unknown> | undefined): boolean {
  const planBlocks = metadata?.planBlocks;
  return typeof planBlocks === 'number' && planBlocks > 0;
}

function sectionName(line: string): string {
  return cleanMarkdownLine(line).replace(/:$/, '').toLowerCase().replace(/\s+/g, ' ');
}

const SECTION_LABELS = new Set([
  'context',
  'background',
  'problem',
  'goal',
  'goals',
  'scope',
  'approach',
  'strategy',
  'design',
  'implementation plan',
  'implementation',
  'plan',
  'files to modify',
  'files changed',
  'affected files',
  'steps',
  'step',
  'tasks',
  'task',
  'checklist',
  'todo',
  'todos',
  'verification',
  'testing',
  'tests',
  'test',
  'validation',
  'reuse',
  'existing utilities',
  'existing code',
  'acceptance criteria',
  'success criteria',
  'summary',
]);

/**
 * Section labels only count as plan structure when the line is a real section
 * header — a markdown heading or a pure label line like `Steps:` / `**Steps**`.
 * Prose that merely starts with "Plan:" or "Verification is running..." must not
 * mint strong plan signals (common in Codex progress narrations).
 */
function isPureSectionLabelLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;

  if (isHeadingLine(trimmed)) {
    return SECTION_LABELS.has(sectionName(trimmed));
  }

  const cleaned = cleanMarkdownLine(trimmed);
  const label = cleaned.replace(/:$/, '').toLowerCase().replace(/\s+/g, ' ');
  return SECTION_LABELS.has(label);
}

function collectPositiveSignals(
  normalized: string,
  lines: string[],
  metadata: Record<string, unknown> | undefined,
): string[] {
  const signals: string[] = [];

  if (metadataHasPlanBlocks(metadata)) signals.push('metadata:proposed-plan-block');

  for (const line of lines) {
    if (!isPureSectionLabelLine(line)) continue;
    const section = sectionName(line);

    if (/^(context|background|problem|goal|goals|scope)$/.test(section)) {
      signals.push('section:context');
      continue;
    }
    if (/^(approach|strategy|design)$/.test(section)) {
      signals.push('section:approach');
      continue;
    }
    if (/^(implementation plan|implementation|plan)$/.test(section)) {
      signals.push('section:implementation-plan');
      continue;
    }
    if (/^(files? to modify|files? changed|affected files?)$/.test(section)) {
      signals.push('section:files-to-modify');
      continue;
    }
    if (/^(steps?|tasks?|checklist|todo|todos)$/.test(section)) {
      signals.push('section:steps');
      continue;
    }
    if (/^(verification|testing|tests?|validation)$/.test(section)) {
      signals.push('section:verification');
      continue;
    }
    if (/^(reuse|existing utilities|existing code)$/.test(section)) {
      signals.push('section:reuse');
      continue;
    }
    if (/^(acceptance criteria|success criteria)$/.test(section)) {
      signals.push('section:acceptance-criteria');
    }
  }

  if (lines.some(isChecklistLine)) signals.push('checklist');

  const orderedStepCount = lines.filter(isOrderedListLine).length;
  if (orderedStepCount >= 2) signals.push('ordered-steps');

  const actionBulletCount = lines.filter((line) => {
    const trimmed = line.trim();
    if (!/^(?:[-*+]|\d+[.)])\s+/.test(trimmed)) return false;
    const cleaned = cleanMarkdownLine(trimmed);
    return /^(?:add|implement|update|modify|create|remove|delete|refactor|test|verify|run|wire|persist|handle|ensure|document|rename|move|extract|reuse|validate)\b/i.test(
      cleaned,
    );
  }).length;
  if (actionBulletCount >= 2) signals.push('action-bullets');

  const nonCodeVisible = visibleText(stripFencedCodeBlocks(normalized));
  if (
    lines.length >= 2 &&
    /\b(?:will|should|need to|needs to|plan to|planned|approach is to|implementation will)\b/i.test(
      nonCodeVisible,
    )
  ) {
    signals.push('future-plan-language');
  }

  const planningPhraseCount =
    nonCodeVisible.match(
      /\b(?:will|should|need to|needs to|plan to|approach|implementation|implement|add|update|modify|create|remove|refactor|test|verify|validate|steps?|tasks?)\b/gi,
    )?.length ?? 0;
  const proseWordCount = wordCount(nonCodeVisible);
  // Long prose needs a handful of planning phrases; short prose (e.g. a terse
  // "update X, add tests, verify it works" note) needs those phrases to make up
  // most of its content instead, so a brief but genuine plan isn't dismissed
  // just for lacking bulk.
  const isPlanningProse =
    (proseWordCount >= 35 && planningPhraseCount >= 4) ||
    (proseWordCount >= 3 &&
      planningPhraseCount >= 3 &&
      planningPhraseCount / proseWordCount >= 0.4);
  if (isPlanningProse) {
    signals.push('planning-prose');
  }

  return unique(signals);
}

function isStrongPositiveSignal(signal: string): boolean {
  return (
    signal === 'metadata:proposed-plan-block' ||
    signal === 'checklist' ||
    signal === 'ordered-steps' ||
    signal === 'action-bullets' ||
    signal === 'planning-prose' ||
    signal === 'section:approach' ||
    signal === 'section:implementation-plan' ||
    signal === 'section:files-to-modify' ||
    signal === 'section:steps' ||
    signal === 'section:acceptance-criteria'
  );
}

function hasStrongPlanSignal(positiveSignals: string[]): boolean {
  const sectionCount = positiveSignals.filter((signal) => signal.startsWith('section:')).length;
  return positiveSignals.some(isStrongPositiveSignal) || sectionCount >= 2;
}

/**
 * Plan *structure* — not generic action prose. Used to rescue execution-style
 * writeups that also contain a real plan outline. Ordered steps / action
 * bullets alone are common in "what I did" reports and must not rescue them.
 */
function hasPlanStructureSignal(positiveSignals: string[]): boolean {
  if (
    positiveSignals.includes('metadata:proposed-plan-block') ||
    positiveSignals.includes('checklist') ||
    positiveSignals.includes('section:approach') ||
    positiveSignals.includes('section:implementation-plan') ||
    positiveSignals.includes('section:files-to-modify') ||
    positiveSignals.includes('section:steps') ||
    positiveSignals.includes('section:acceptance-criteria')
  ) {
    return true;
  }
  const sectionCount = positiveSignals.filter((signal) => signal.startsWith('section:')).length;
  return sectionCount >= 2;
}

function isPromptLikeOneLiner(line: string): boolean {
  if (isHeadingLine(line) || isChecklistLine(line) || isOrderedListLine(line)) return false;

  const cleaned = cleanMarkdownLine(line).toLowerCase();
  if (!cleaned) return false;

  return [
    /^(?:important:\s*)?work in\b/,
    /^(?:please|pls)\b/,
    /^(?:can|could|would|will)\s+you\b/,
    /^(?:i|we)\s+(?:need|want|would like|have to)\b/,
    /^(?:help|fix|implement|create|add|update|remove|delete|refactor|write|review|investigate|debug|plan)\b/,
    /\?$/,
    /\b(?:repository|repo|existing branch|worktree|pull request|pr)\b/,
  ].some((pattern) => pattern.test(cleaned));
}

function normalizedTitle(title: string | undefined): string {
  return cleanMarkdownLine(title ?? '').toLowerCase();
}

function looksLikeWrapperTitle(title: string | undefined): boolean {
  const raw = (title ?? '').trim();
  // Agent harness wrappers, XML envelope tags, and task envelopes are never plan titles.
  return (
    /^<[a-z][\w:-]*(?:\s[^>]*)?>/i.test(raw) ||
    /^<\/?[a-z][\w:-]*>$/i.test(raw) ||
    /^(?:TASK|LENS)\s*:/i.test(raw)
  );
}

/** XML control envelopes are never meaningful plan titles, even when body is structured. */
function isHardWrapperTitle(title: string | undefined): boolean {
  const raw = (title ?? '').trim();
  return (
    /^<(?:recommended_plugins|user_action|user_instructions|user_prompt|environment_context|system-reminder|hook_prompt|codex_internal_context|subagent_notification|skill|instructions|image|permissions)\b/i.test(
      raw,
    ) || /^<\/?[a-z][\w:-]*>$/i.test(raw)
  );
}

function looksLikePromptTitle(title: string | undefined): boolean {
  const cleaned = normalizedTitle(title);
  if (!cleaned) return false;

  // Strip a leading <task>…</task> envelope so the inner prompt still matches.
  const withoutTaskEnvelope = cleaned
    .replace(/^<\/?task\b[^>]*>/gi, '')
    .replace(/<\/task>/gi, '')
    .trim();
  const candidate = withoutTaskEnvelope || cleaned;

  return [
    /^(?:important:\s*)?work in\b/,
    /^review the code changes against\b/,
    /^perform a .*review\b/,
    /^(?:please|pls)\b/,
    /^(?:can|could|would|will)\s+you\b/,
    /^(?:i|we)\s+(?:need|want|would like|have to)\b/,
    /^(?:help|fix|implement|create|add|update|remove|delete|refactor|write|review|investigate|debug|plan)\b/,
    /\?$/,
    /\b(?:repository|repo|existing branch|worktree|pull request|pr)\b/,
  ].some((pattern) => pattern.test(candidate));
}

const CONVENTIONAL_COMMIT_SUBJECT =
  /^(?:feat|fix|chore|docs|refactor|test|ci|build|perf|style|revert)(?:\([^)]+\))?!?:\s+\S/i;

function looksLikeCommitMessage(lines: string[]): boolean {
  const first = lines[0] ?? '';
  if (!CONVENTIONAL_COMMIT_SUBJECT.test(first)) return false;
  // A real plan that happens to start with a commit-style heading still has
  // structure elsewhere; those are handled by hasPlanStructureSignal at the
  // call site. Here we only detect the commit-message shape.
  return true;
}

function looksLikeReviewOutput(normalized: string, title: string | undefined): boolean {
  const cleanedTitle = normalizedTitle(title);
  const lower = normalized.toLowerCase();
  const trimmed = normalized.trim();

  return (
    /^review the code changes against\b/.test(cleanedTitle) ||
    /^perform a .*review\b/.test(cleanedTitle) ||
    /"findings"\s*:\s*\[/.test(normalized) ||
    /"overall_correctness"\s*:/.test(normalized) ||
    /\bfull review comments\s*:/i.test(normalized) ||
    /\bthe patch (?:currently )?(?:breaks|introduces|regresses)\b/i.test(normalized) ||
    /\bshould not be considered correct\b/i.test(lower) ||
    // Codex review/audit verdicts and finding lists (not implementation plans).
    /^(?:\*{0,2}VERDICT\*{0,2}\s*:\s*)?(?:FAIL|PASS|FAILED|PASSED)\b/im.test(trimmed) ||
    /^(?:\*{0,2}Verdict\*{0,2}\s*:\s*)/im.test(trimmed) ||
    /^(?:INVESTIGATE|FINDINGS?)\b(?:\s*[—:-]|\s*$)/im.test(trimmed) ||
    /^- \*\*INVESTIGATE\b/im.test(trimmed) ||
    /"severity"\s*:\s*"(?:CRITICAL|HIGH|MEDIUM|LOW|INFORMATIONAL)"/i.test(normalized) ||
    /\b(?:CRITICAL|HIGH)\b.*\bconfidence\b/i.test(normalized) ||
    /(?:^|\n)\s*(?:\d+\.\s+)?\*{0,2}\[P[0-3]\]\*{0,2}\b/i.test(normalized) ||
    /^\s*(?:three|four|five|\d+)\s+findings?\s*:/im.test(trimmed) ||
    /\bread-only review(?:;|,|\.)?\s*no files modified\b/i.test(lower)
  );
}

function looksLikeSystemContext(normalized: string, lines: string[]): boolean {
  const lower = normalized.toLowerCase();
  if (
    lower.startsWith('# agents.md instructions') ||
    lower.startsWith('<environment_context>') ||
    lower.startsWith('<system-reminder>') ||
    lower.startsWith('<thinking>')
  ) {
    return true;
  }

  const wrapperMatches = normalized.match(
    /<\/?(?:environment_context|system-reminder|thinking|analysis|reasoning|tool_call|tool_result)\b[^>]*>/gi,
  );
  if (wrapperMatches && wrapperMatches.length >= 2) return true;

  const wrapperLineCount = lines.filter((line) =>
    /^(?:analysis|reasoning|thought|assistant thought|system|developer):\b/i.test(line),
  ).length;
  return wrapperLineCount > 0 && wrapperLineCount / Math.max(lines.length, 1) >= 0.4;
}

function looksLikeToolLog(normalized: string): boolean {
  return (
    /::[a-z0-9_-]+(?:\{|\[|\s*$)/i.test(normalized) ||
    /<\/?(?:tool_call|tool_result)\b[^>]*>/i.test(normalized) ||
    /\b(?:function_call|tool_calls|tool_result)\b/i.test(normalized) ||
    /\[external_agent_tool_call\b/i.test(normalized) ||
    /\[external_agent_tool_result\b/i.test(normalized)
  );
}

function looksLikeConversationArtifact(lines: string[]): boolean {
  const roleLineCount = lines.filter((line) =>
    /^(?:[-*+]\s+)?(?:\*\*)?(?:user|assistant|system|developer|tool|agent)(?:\*\*)?\s*:/i.test(
      line.trim(),
    ),
  ).length;

  if (roleLineCount >= 2) return true;

  const wrapperCount = lines.filter((line) =>
    /^<\/?(?:user_action|user_prompt|assistant_response|message|conversation)\b/i.test(line.trim()),
  ).length;
  return wrapperCount >= 2;
}

function looksLikeExecutionReport(normalized: string): boolean {
  const hasPastCompletion =
    /\b(?:fixed|pushed|committed|completed|done|implemented|updated|changed|patched|merged|deployed|passed|failed|resolved|reverted)\b/i.test(
      normalized,
    );
  const hasReportSection = /^\s*(?:summary|result|results|changes|verification|status)\s*:/im.test(
    normalized,
  );
  const hasReviewReportMarker = /\b(?:review findings?|review issues?|review comments?)\b/i.test(
    normalized,
  );
  const hasCommandMarker =
    /::[a-z0-9_-]+(?:\{|\[|\s*$)/im.test(normalized) ||
    // Word boundaries so backticked identifiers like `NatsConnection` ("tsc")
    // or `digitize` ("git") don't read as shell commands.
    /`[^`]*\b(?:bun|npm|pnpm|yarn|git|tsc|oxfmt|oxlint|biome)\b[^`]*`/i.test(normalized) ||
    /\b(?:git\s+(?:stage|commit|push|status)|bunx?\s+|npm\s+|pnpm\s+|yarn\s+)\b/i.test(normalized);
  const hasStatusVerdict =
    /^(?:\*{0,2}VERDICT\*{0,2}\s*:\s*)?(?:FAIL|PASS|FAILED|PASSED)\b/im.test(normalized.trim()) ||
    /^(?:\*{0,2}Verdict\*{0,2}\s*:)/im.test(normalized.trim());
  const hasRemainingGaps =
    /\b(?:remaining (?:contract )?gaps?|remaining (?:issues?|work)|true first-bad)\b/i.test(
      normalized,
    );

  return (
    (hasPastCompletion && (hasReportSection || hasCommandMarker || hasReviewReportMarker)) ||
    (hasStatusVerdict && (hasPastCompletion || hasRemainingGaps || hasCommandMarker)) ||
    (hasRemainingGaps && hasPastCompletion)
  );
}

/**
 * Codex commentary / status streams: first-person progressive updates often
 * joined with `---` separators. These are live work logs, not plans.
 * Codex frequently emits curly apostrophes (I'm / I'll), so match both.
 */
const APOSTROPHE = "['\u2019]";

function looksLikeProgressNarrative(normalized: string, lines: string[]): boolean {
  const separatorCount = (normalized.match(/^\s*---\s*$/gm) ?? []).length;

  const firstPersonOpener = new RegExp(
    `^(?:I(?:${APOSTROPHE}m| am|${APOSTROPHE}ll| will|${APOSTROPHE}ve| have)|We(?:${APOSTROPHE}re| are|${APOSTROPHE}ll| will))\\b`,
    'i',
  );
  const firstPersonProgress = new RegExp(
    `\\bI(?:${APOSTROPHE}m| am) (?:now |also |still )?(?:using|applying|running|checking|looking|tracing|mapping|tightening|switching|waiting|keeping|retaining|documenting|starting|loading|reading|verifying|rerunning|continuing|extracting|isolating|implementing|following|treating|stopping|removing|rewriting|correlating)\\b`,
    'i',
  );

  const isFirstPersonStatus = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    return firstPersonOpener.test(trimmed) || firstPersonProgress.test(trimmed);
  };

  const progressLineCount = lines.filter(isFirstPersonStatus).length;
  if (progressLineCount === 0) return false;

  // Multi-segment Codex status streams joined with ---.
  if (separatorCount >= 2 && progressLineCount >= 3) return true;

  // Dense first-person status without separators (short commentary dumps).
  if (lines.length >= 4 && progressLineCount / lines.length >= 0.35) return true;

  // Long streams where many paragraphs open in first-person progressive.
  if (separatorCount >= 1 && progressLineCount >= 5) return true;

  // Very long multi-segment status dumps (Codex final_answer joins many turns).
  if (separatorCount >= 4 && progressLineCount >= 2) return true;

  return false;
}

function lowValueAssessment(reasons: PlanLowValueReason[], signals: string[]): PlanValueAssessment {
  return {
    lowValue: reasons.length > 0,
    reasons: unique(reasons),
    signals: unique(signals).slice(0, 20),
  };
}

export function assessPlanValue(input: AssessPlanValueInput): PlanValueAssessment {
  const metadata = withoutLowValueMetadata(input.metadata);
  const normalized = normalizePlanContent(input.content);
  const lines = meaningfulLines(normalized);
  const positiveSignals = collectPositiveSignals(normalized, lines, metadata);
  const signals = [...positiveSignals];
  const reasons: PlanLowValueReason[] = [];

  if (!VISIBLE_TEXT_REGEX.test(visibleText(normalized))) {
    return lowValueAssessment(['empty-content'], ['negative:empty-content']);
  }

  if (isHeadingOnly(lines)) {
    return lowValueAssessment(['heading-only'], [...signals, 'negative:heading-only']);
  }

  const explicitPlanBlock = metadataHasPlanBlocks(metadata);
  const strongPositive = hasStrongPlanSignal(positiveSignals);
  const planStructure = hasPlanStructureSignal(positiveSignals);
  const systemContext = looksLikeSystemContext(normalized, lines);
  const toolLog = looksLikeToolLog(normalized);
  const conversationArtifact = looksLikeConversationArtifact(lines);
  const executionReport = looksLikeExecutionReport(normalized);
  const progressNarrative = looksLikeProgressNarrative(normalized, lines);
  const commitMessage = looksLikeCommitMessage(lines);
  const wrapperTitle = looksLikeWrapperTitle(input.title);
  const promptTitle = looksLikePromptTitle(input.title);
  const reviewOutput = looksLikeReviewOutput(normalized, input.title);
  const codeMetrics = codeBlockMetrics(normalized);
  const codeOnly = codeMetrics.codeBlockCount > 0 && codeMetrics.nonCodeWordCount === 0;
  const codeDominated =
    codeMetrics.codeBlockCount > 0 &&
    codeMetrics.codeShare >= 0.6 &&
    codeMetrics.nonCodeWordCount < 120;

  if (systemContext) signals.push('negative:system-context');
  if (toolLog) signals.push('negative:tool-log');
  if (conversationArtifact) signals.push('negative:conversation-artifact');
  if (executionReport) signals.push('negative:execution-report');
  if (progressNarrative) signals.push('negative:progress-narrative');
  if (commitMessage) signals.push('negative:commit-message');
  if (wrapperTitle) signals.push('negative:wrapper-title');
  if (promptTitle) signals.push('negative:prompt-title');
  if (reviewOutput) signals.push('negative:review-output');
  if (codeMetrics.codeBlockCount > 0) signals.push('shape:code-blocks');
  if (codeOnly) signals.push('negative:code-only');
  if (codeDominated) signals.push('negative:code-dominated');
  if (lines.length === 1) signals.push('shape:single-line');

  if (lines.length === 1 && positiveSignals.length === 0) {
    reasons.push(isPromptLikeOneLiner(lines[0] ?? '') ? 'prompt-like' : 'no-plan-signals');
  }

  if (systemContext && !explicitPlanBlock) reasons.push('system-context');
  if (toolLog && !explicitPlanBlock) reasons.push('tool-log');
  if (conversationArtifact && !explicitPlanBlock && !strongPositive)
    reasons.push('conversation-artifact');
  // Execution reports share vocabulary with forward-looking plans ("done",
  // verification commands). Only true plan structure rescues them — not
  // ordered-steps / action-bullets / planning-prose alone, which are common in
  // completed-work writeups.
  if (executionReport && !explicitPlanBlock && !planStructure) reasons.push('execution-report');
  // Progress / status narrations can mention future work ("I'll fix…") and even
  // a mid-stream "Plan:" sentence; only an explicit proposed_plan block rescues.
  if (progressNarrative && !explicitPlanBlock) reasons.push('progress-narrative');
  if (commitMessage && !explicitPlanBlock && !planStructure) reasons.push('commit-message');
  // Hard XML envelopes (recommended_plugins, user_instructions, image, …) never
  // produce a real plan title — only an explicit proposed_plan block rescues them.
  // Softer wrappers (TASK:/LENS:/<task>) may still wrap a structured plan body.
  if (isHardWrapperTitle(input.title) && !explicitPlanBlock) reasons.push('wrapper-title');
  else if (wrapperTitle && !explicitPlanBlock && !planStructure) reasons.push('wrapper-title');
  if (reviewOutput && !explicitPlanBlock) reasons.push('review-output');
  if (promptTitle && !strongPositive && !explicitPlanBlock) reasons.push('prompt-like');
  if (codeOnly && !explicitPlanBlock && !strongPositive) reasons.push('code-only');
  if (codeDominated && !explicitPlanBlock && !strongPositive) reasons.push('code-dominated');

  if (reasons.length === 0 && !strongPositive && !positiveSignals.includes('planning-prose')) {
    reasons.push('no-plan-signals');
  }

  return lowValueAssessment(reasons, signals);
}

export function annotatePlanValueMetadata(plan: Plan): Plan {
  const baseMetadata = withoutLowValueMetadata(plan.metadata);
  const assessment = assessPlanValue({
    content: plan.content,
    title: plan.title,
    metadata: baseMetadata,
  });

  if (!assessment.lowValue) {
    return {
      ...plan,
      metadata: baseMetadata,
    };
  }

  return {
    ...plan,
    metadata: {
      ...baseMetadata,
      lowValue: true,
      lowValueReasons: assessment.reasons,
      lowValueSignals: assessment.signals,
    },
  };
}
