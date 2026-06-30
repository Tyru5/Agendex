type PlanMetadata = Record<string, unknown>;

type PlanWithMetadata = {
  title?: string;
  content?: string;
  metadata?: unknown;
};

const LOW_VALUE_WRAPPER_TITLE_REGEX = /^<user_(?:action|instructions|prompt)>$/i;
const VISIBLE_TEXT_REGEX = /[\p{L}\p{N}]/u;

function isRecord(value: unknown): value is PlanMetadata {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
      .replace(/&lt;\s*\/?\s*proposed_plan\s*&gt;/gi, '')
      .replace(/<\s*\/?\s*proposed_plan\s*>/gi, ''),
  ).trim();
}

function visibleText(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '')
    .replace(/&lt;\s*\/?\s*proposed_plan\s*&gt;/gi, '')
    .replace(/<\s*\/?\s*proposed_plan\s*>/gi, '')
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

function normalizedTitle(title: string | undefined): string {
  return cleanMarkdownLine(title ?? '').toLowerCase();
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

function hasExplicitPlanBlock(metadata: PlanMetadata | undefined): boolean {
  return typeof metadata?.planBlocks === 'number' && metadata.planBlocks > 0;
}

function hasStrongPlanSignal(
  normalized: string,
  lines: string[],
  metadata: PlanMetadata | undefined,
): boolean {
  if (hasExplicitPlanBlock(metadata)) return true;
  if (lines.some(isChecklistLine)) return true;
  if (lines.filter(isOrderedListLine).length >= 2) return true;

  const actionBulletCount = lines.filter((line) => {
    const trimmed = line.trim();
    if (!/^(?:[-*+]|\d+[.)])\s+/.test(trimmed)) return false;
    const cleaned = cleanMarkdownLine(trimmed);
    return /^(?:add|implement|update|modify|create|remove|delete|refactor|test|verify|run|wire|persist|handle|ensure|document|rename|move|extract|reuse|validate)\b/i.test(
      cleaned,
    );
  }).length;
  if (actionBulletCount >= 2) return true;

  const strongSectionCount = lines.filter((line) => {
    const section = cleanMarkdownLine(line).replace(/:$/, '').toLowerCase().replace(/\s+/g, ' ');
    return /^(?:approach|strategy|design|implementation plan|implementation|plan|files? to modify|files? changed|affected files?|steps?|tasks?|checklist|todo|todos|acceptance criteria|success criteria)\b/.test(
      section,
    );
  }).length;

  return (
    strongSectionCount >= 1 &&
    /\b(?:will|should|need to|needs to|plan to|implementation will)\b/i.test(normalized)
  );
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

  return hasPastCompletion && (hasReportSection || hasReviewReportMarker || hasCommandMarker);
}

function shouldBypassHeuristic(metadata: PlanMetadata | undefined): boolean {
  return metadata?.userCreated === true || metadata?.source === 'custom-dir';
}

export function hasLowValueMetadata(metadata: unknown): boolean {
  if (!isRecord(metadata)) return false;
  if (shouldBypassHeuristic(metadata)) return false;
  return metadata.lowValue === true;
}

export function mergePlanMetadata(existing: unknown, incoming: unknown): unknown {
  if (!isRecord(existing)) return incoming;
  if (!isRecord(incoming)) {
    const cleared = { ...existing };
    delete cleared.lowValue;
    delete cleared.lowValueReasons;
    delete cleared.lowValueSignals;
    return cleared;
  }
  const merged = { ...existing, ...incoming };
  if (incoming.userCreated === true) {
    delete merged.lowValue;
    delete merged.lowValueReasons;
    delete merged.lowValueSignals;
  }
  return merged;
}

export function isLikelyLowValuePlan(plan: PlanWithMetadata): boolean {
  const metadata = isRecord(plan.metadata) ? plan.metadata : undefined;
  if (shouldBypassHeuristic(metadata)) return false;

  const normalized = normalizePlanContent(plan.content ?? '');
  const lines = meaningfulLines(normalized);

  if (!VISIBLE_TEXT_REGEX.test(visibleText(normalized))) return true;
  if (isHeadingOnly(lines)) return true;

  const explicitPlanBlock = hasExplicitPlanBlock(metadata);
  const wrapperTitle = LOW_VALUE_WRAPPER_TITLE_REGEX.test((plan.title ?? '').trim());
  const reviewOutput = looksLikeReviewOutput(normalized, plan.title);
  if (!explicitPlanBlock && (wrapperTitle || reviewOutput)) return true;

  const strongPositive = hasStrongPlanSignal(normalized, lines, metadata);
  if (strongPositive) return false;

  return (
    looksLikeSystemContext(normalized, lines) ||
    looksLikeExecutionReport(normalized) ||
    looksLikePromptTitle(plan.title) ||
    (lines.length === 1 && !isChecklistLine(lines[0] ?? '') && !isOrderedListLine(lines[0] ?? ''))
  );
}

export function isVisiblePlan(plan: PlanWithMetadata): boolean {
  return !hasLowValueMetadata(plan.metadata) && !isLikelyLowValuePlan(plan);
}

export function filterVisiblePlans<T extends PlanWithMetadata>(plans: T[]): T[] {
  return plans.filter(isVisiblePlan);
}
