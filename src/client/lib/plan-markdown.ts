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
