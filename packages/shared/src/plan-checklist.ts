/** Compact checklist progress that can travel with plan list rows instead of full content. */
export type PlanChecklistSummary = {
  total: number;
  completed: number;
  nextStep?: string;
};

export type PlanChecklist = PlanChecklistSummary & {
  remaining: number;
};

function cleanTaskLabel(value: string): string {
  return value
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Counts Markdown task items and returns the first unchecked task as the next step. */
export function extractPlanChecklist(content: string): PlanChecklist {
  const taskPattern = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])]\s+(.+?)\s*$/gm;
  let total = 0;
  let completed = 0;
  let nextStep: string | undefined;

  for (const match of content.matchAll(taskPattern)) {
    total++;
    const isCompleted = match[1]?.toLowerCase() === 'x';
    if (isCompleted) {
      completed++;
      continue;
    }
    if (!nextStep) {
      const label = cleanTaskLabel(match[2] ?? '');
      if (label) nextStep = label;
    }
  }

  return {
    total,
    completed,
    remaining: Math.max(0, total - completed),
    nextStep,
  };
}

/** Expands a transported summary back into full checklist progress. */
export function checklistFromSummary(summary: PlanChecklistSummary): PlanChecklist {
  return {
    total: summary.total,
    completed: summary.completed,
    remaining: Math.max(0, summary.total - summary.completed),
    nextStep: summary.nextStep,
  };
}
