const PROPOSED_PLAN_TAG_REGEX = /<\s*\/?\s*proposed_plan\s*>/gi;
const ESCAPED_PROPOSED_PLAN_TAG_REGEX = /&lt;\s*\/?\s*proposed_plan\s*&gt;/gi;

function stripProposedPlanTags(markdown: string): string {
  return markdown.replace(ESCAPED_PROPOSED_PLAN_TAG_REGEX, '').replace(PROPOSED_PLAN_TAG_REGEX, '');
}

export function normalizePlanMarkdown(markdown: string): string {
  if (!markdown) return '';
  return stripProposedPlanTags(markdown.replace(/\r\n?/g, '\n')).trim();
}
