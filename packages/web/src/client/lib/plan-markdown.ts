const PROPOSED_PLAN_TAG_REGEX = /<\s*\/?\s*proposed_plan\s*>/gi;
const ESCAPED_PROPOSED_PLAN_TAG_REGEX = /&lt;\s*\/?\s*proposed_plan\s*&gt;/gi;
const ESCAPED_FENCE_MARKER_REGEX = /^([ \t]*)\\(```+|~~~+)([^\n]*)$/gm;

function stripProposedPlanTags(markdown: string): string {
  return markdown.replace(ESCAPED_PROPOSED_PLAN_TAG_REGEX, '').replace(PROPOSED_PLAN_TAG_REGEX, '');
}

function unescapeFencedCodeMarkers(markdown: string): string {
  return markdown.replace(ESCAPED_FENCE_MARKER_REGEX, '$1$2$3');
}

export function normalizePlanMarkdown(markdown: string): string {
  if (!markdown) return '';
  return stripProposedPlanTags(unescapeFencedCodeMarkers(markdown.replace(/\r\n?/g, '\n'))).trim();
}

const MD_HEADING = /^#{1,6}\s+\S/m;
const MD_BOLD = /\*\*[^*]+\*\*/;
const MD_LIST = /^[ \t]*[-*+]\s+\S/m;
const MD_ORDERED_LIST = /^[ \t]*\d+\.\s+\S/m;
const MD_FENCE = /^[ \t]*```/m;

export function looksLikeMarkdown(content: string): boolean {
  if (!content) return false;
  let signals = 0;
  if (MD_HEADING.test(content)) signals++;
  if (MD_BOLD.test(content)) signals++;
  if (MD_LIST.test(content)) signals++;
  if (MD_ORDERED_LIST.test(content)) signals++;
  if (MD_FENCE.test(content)) signals++;
  return signals >= 2;
}
