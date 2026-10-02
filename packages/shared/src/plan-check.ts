import { candidatePathsForValidation, extractCandidateCodePaths } from './plan-paths.ts';
import { assessPlanValue } from './services/plan-value.ts';

export type PlanCheckCode =
  | 'verification'
  | 'acceptance-criteria'
  | 'missing-files'
  | 'ambiguous-files';
export interface PlanCheckFinding {
  code: PlanCheckCode;
  message: string;
  paths?: string[];
}
export type PlanCheckPathResult =
  | { status: 'found' }
  | { status: 'missing' }
  | { status: 'ambiguous'; matches: readonly string[] }
  | { status: 'unavailable' };
export interface PlanCheck {
  fileCount: number;
  checkedFileCount: number;
  pathStatus: 'ready' | 'partial' | 'unavailable';
  verificationDetected: boolean;
  acceptanceCriteriaDetected: boolean;
  findings: PlanCheckFinding[];
}

function sectionLabel(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s+/, '')
    .replace(/\*\*/g, '')
    .replace(/:$/, '')
    .trim();
}
function isPlaceholder(line: string): boolean {
  const cleaned = line
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .trim()
    .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^\[[ xX]\]\s*/, '')
    .replace(/[`*_]/g, '')
    .trim();
  return (
    !cleaned ||
    /^(?:todo|tbd|pending|to be (?:defined|determined|added))\b/i.test(cleaned) ||
    /^(?:none|n\/a)\b[.!:…\s-]*$/i.test(cleaned)
  );
}
const CHECK_SECTION_LABEL =
  /^(?:verification|testing|tests?|validation|acceptance criteria|success criteria)$/i;
function headingLevel(text: string): number | undefined {
  return /^(#{1,6})\s/.exec(text)?.[1]?.length;
}
function hasSectionBody(content: string, label: RegExp): boolean {
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? '';
    if (!label.test(sectionLabel(line))) continue;
    // Markdown sections end at a same-or-higher heading; deeper subheadings organize
    // their content. Bold/colon label sections end at any heading or label.
    const level = headingLevel(line);
    for (const following of lines.slice(index + 1)) {
      const text = following.trim();
      if (!text) continue;
      const nextLevel = headingLevel(text);
      const isLabel = /^(?:\*\*[^*]+\*\*:?|[A-Za-z ]+:)$/.test(text);
      if (nextLevel !== undefined || isLabel) {
        const nested =
          level !== undefined &&
          (nextLevel === undefined ? true : nextLevel > level) &&
          !CHECK_SECTION_LABEL.test(sectionLabel(text));
        if (!nested) break;
        continue;
      }
      if (!isPlaceholder(text)) return true;
    }
  }
  return false;
}
function evidenceText(content: string): string {
  // A fenced example markdown plan must not satisfy the surrounding plan. Shell
  // commands are legitimate verification evidence, including commands in fences.
  return content
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(
      /^([ \t]*)(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)(?:^[ \t]*\2[ \t]*$|$(?![\s\S]))/gm,
      (_block, _indent, _fence, language: string, body: string) => {
        if (!/^(?:sh|bash|shell|zsh|console|powershell)?\s*$/i.test(language)) return '';
        return body
          .split('\n')
          .filter(
            (line) =>
              /^(?:\$\s*)?pytest\b/i.test(line.trim()) ||
              /^(?:\$\s*)?(?:bun|npm|pnpm|yarn|cargo|go|make)\b[^\n]*\b(?:test|check|lint|build|vet)\b/i.test(
                line.trim(),
              ),
          )
          .join('\n');
      },
    );
}

/** Advisory evidence, not an approval decision. Shared by the viewer and local API. */
export function checkPlan(
  plan: { content: string; title?: string; metadata?: Record<string, unknown> },
  pathResults: Readonly<Record<string, PlanCheckPathResult>> = {},
): PlanCheck {
  const paths = candidatePathsForValidation(extractCandidateCodePaths(plan.content));
  const prose = evidenceText(plan.content);
  const assessment = assessPlanValue({ ...plan, content: prose });
  const verificationDetected =
    /(?:\b(?:run|execute)\s+`?|^\s*(?:\$\s*)?)pytest\b/im.test(prose) ||
    (assessment.signals.includes('section:verification') &&
      hasSectionBody(prose, /^(?:verification|testing|tests?|validation)$/i)) ||
    /(?:\b(?:run|execute)\s+`?|^\s*(?:\$\s*)?)(?:bun|npm|pnpm|yarn|pytest|cargo|go|make)\b[^\n]*\b(?:test|check|lint|build|vet)\b/im.test(
      prose,
    ) ||
    prose.split('\n').some((line) => {
      const phrase = line.match(/\b(?:verify|validate|test)\s+(?:that|the|with|using)\b([^.!?]*)/i);
      return Boolean(phrase && !isPlaceholder(phrase[1] ?? ''));
    });
  const acceptanceCriteriaDetected =
    (assessment.signals.includes('section:acceptance-criteria') &&
      hasSectionBody(prose, /^(?:acceptance criteria|success criteria)$/i)) ||
    prose.split('\n').some((line) => {
      const phrase = line.match(/\b(?:done|complete|successful)\s+(?:when|if)\b([^.!?]*)/i);
      return Boolean(phrase && !isPlaceholder(phrase[1] ?? ''));
    }) ||
    prose.split('\n').some((line) => {
      const match = line.match(/\bacceptance criteria\s*:(.*)$/i);
      return Boolean(match && !isPlaceholder(match[1] ?? ''));
    });
  const findings: PlanCheckFinding[] = [];
  if (!verificationDetected)
    findings.push({
      code: 'verification',
      message: 'No verification step detected. Describe how the change will be tested.',
    });
  if (!acceptanceCriteriaDetected)
    findings.push({
      code: 'acceptance-criteria',
      message: 'No acceptance criteria detected. Describe what successful completion looks like.',
    });
  const missing: string[] = [];
  const ambiguous: string[] = [];
  let checkedFileCount = 0;
  for (const path of paths) {
    const result = pathResults[path];
    if (!result || result.status === 'unavailable') continue;
    checkedFileCount += 1;
    if (result.status === 'missing') missing.push(path);
    if (result.status === 'ambiguous') ambiguous.push(path);
  }
  if (missing.length)
    findings.push({
      code: 'missing-files',
      message: 'These paths were not found. They may be files the plan intends to create.',
      paths: missing,
    });
  if (ambiguous.length)
    findings.push({
      code: 'ambiguous-files',
      message: 'These references match multiple files. Use a more specific path.',
      paths: ambiguous,
    });
  return {
    fileCount: paths.length,
    checkedFileCount,
    pathStatus:
      checkedFileCount === paths.length
        ? 'ready'
        : checkedFileCount > 0
          ? 'partial'
          : 'unavailable',
    verificationDetected,
    acceptanceCriteriaDetected,
    findings,
  };
}

/** Summaries from the intentional authenticated local recovery API. Content is fetched separately. */
export interface HiddenPlanSummary {
  id: string;
  title: string;
  agent: string;
  workspace?: string;
  filePath: string;
  updatedAt: string;
  restored: boolean;
  assessment: { lowValue: boolean; reasons: string[]; signals: string[] };
}
