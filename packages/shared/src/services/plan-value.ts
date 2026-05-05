import type { Plan } from '../types.ts';

export type PlanLowValueReason =
  | 'empty-content'
  | 'heading-only'
  | 'prompt-like'
  | 'system-context'
  | 'execution-report'
  | 'review-output'
  | 'wrapper-title'
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
  const next = { ...(metadata ?? {}) };
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
  return lines.length > 0 && lines.some(isHeadingLine) && lines.every(isHeadingLine);
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
]);

function hasSectionSyntax(line: string, section: string): boolean {
  const cleaned = cleanMarkdownLine(line);
  return (
    isHeadingLine(line) || /^[a-z][\w\s/&+-]{1,48}:/i.test(cleaned) || SECTION_LABELS.has(section)
  );
}

function collectPositiveSignals(
  normalized: string,
  lines: string[],
  metadata: Record<string, unknown> | undefined,
): string[] {
  const signals: string[] = [];

  if (metadataHasPlanBlocks(metadata)) signals.push('metadata:proposed-plan-block');

  for (const line of lines) {
    const section = sectionName(line);
    if (!hasSectionSyntax(line, section)) continue;

    if (/^(context|background|problem|goal|goals|scope)\b/.test(section)) {
      signals.push('section:context');
      continue;
    }
    if (/^(approach|strategy|design)\b/.test(section)) {
      signals.push('section:approach');
      continue;
    }
    if (/^(implementation plan|implementation|plan)\b/.test(section)) {
      signals.push('section:implementation-plan');
      continue;
    }
    if (/^(files? to modify|files? changed|affected files?)\b/.test(section)) {
      signals.push('section:files-to-modify');
      continue;
    }
    if (/^(steps?|tasks?|checklist|todo|todos)\b/.test(section)) {
      signals.push('section:steps');
      continue;
    }
    if (/^(verification|testing|tests?|validation)\b/.test(section)) {
      signals.push('section:verification');
      continue;
    }
    if (/^(reuse|existing utilities|existing code)\b/.test(section)) {
      signals.push('section:reuse');
      continue;
    }
    if (/^(acceptance criteria|success criteria)\b/.test(section)) {
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

  if (
    lines.length >= 2 &&
    /\b(?:will|should|need to|needs to|plan to|planned|approach is to|implementation will)\b/i.test(
      normalized,
    )
  ) {
    signals.push('future-plan-language');
  }

  return unique(signals);
}

function isStrongPositiveSignal(signal: string): boolean {
  return (
    signal === 'metadata:proposed-plan-block' ||
    signal === 'checklist' ||
    signal === 'ordered-steps' ||
    signal === 'action-bullets' ||
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
  return /^<user_(?:action|instructions|prompt)>$/i.test((title ?? '').trim());
}

function looksLikePromptTitle(title: string | undefined): boolean {
  const cleaned = normalizedTitle(title);
  if (!cleaned) return false;

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
  ].some((pattern) => pattern.test(cleaned));
}

function looksLikeReviewOutput(normalized: string, title: string | undefined): boolean {
  const cleanedTitle = normalizedTitle(title);
  const lower = normalized.toLowerCase();

  return (
    /^review the code changes against\b/.test(cleanedTitle) ||
    /^perform a .*review\b/.test(cleanedTitle) ||
    /"findings"\s*:\s*\[/.test(normalized) ||
    /"overall_correctness"\s*:/.test(normalized) ||
    /\bfull review comments\s*:/i.test(normalized) ||
    /\bthe patch (?:currently )?(?:breaks|introduces|regresses)\b/i.test(normalized) ||
    /\bshould not be considered correct\b/i.test(lower)
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
    /\b(?:function_call|tool_calls|tool_result)\b/i.test(normalized)
  );
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
    /`[^`]*(?:bun|npm|pnpm|yarn|git|tsc|oxfmt|oxlint|biome)[^`]*`/i.test(normalized) ||
    /\b(?:git\s+(?:stage|commit|push|status)|bunx?\s+|npm\s+|pnpm\s+|yarn\s+)\b/i.test(normalized);

  return hasPastCompletion && (hasReportSection || hasCommandMarker || hasReviewReportMarker);
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
  const systemContext = looksLikeSystemContext(normalized, lines);
  const toolLog = looksLikeToolLog(normalized);
  const executionReport = looksLikeExecutionReport(normalized);
  const wrapperTitle = looksLikeWrapperTitle(input.title);
  const promptTitle = looksLikePromptTitle(input.title);
  const reviewOutput = looksLikeReviewOutput(normalized, input.title);

  if (systemContext) signals.push('negative:system-context');
  if (toolLog) signals.push('negative:tool-log');
  if (executionReport) signals.push('negative:execution-report');
  if (wrapperTitle) signals.push('negative:wrapper-title');
  if (promptTitle) signals.push('negative:prompt-title');
  if (reviewOutput) signals.push('negative:review-output');
  if (lines.length === 1) signals.push('shape:single-line');

  if (lines.length === 1 && positiveSignals.length === 0) {
    reasons.push(isPromptLikeOneLiner(lines[0] ?? '') ? 'prompt-like' : 'no-plan-signals');
  }

  if (systemContext && !strongPositive) reasons.push('system-context');
  if (executionReport && !strongPositive) reasons.push('execution-report');
  if (wrapperTitle && !explicitPlanBlock) reasons.push('wrapper-title');
  if (reviewOutput && !explicitPlanBlock) reasons.push('review-output');
  if (promptTitle && !strongPositive && positiveSignals.length === 0) reasons.push('prompt-like');
  if (toolLog && !strongPositive && positiveSignals.length === 0) reasons.push('no-plan-signals');

  if (reasons.length === 0 && positiveSignals.length === 0 && lines.length <= 3) {
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
