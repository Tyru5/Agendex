export type PlanAnnotationKind =
  | 'comment'
  | 'replacement'
  | 'deletion'
  | 'insertion'
  | 'global_comment';
export type PlanAnnotationStatus = 'draft' | 'open' | 'submitted' | 'resolved';

export interface PlanTextAnchor {
  quote?: string;
  startOffset?: number;
  endOffset?: number;
  occurrenceIndex?: number;
  prefix?: string;
  suffix?: string;
  contentHash?: string;
}

export interface PlanAnnotationRecord {
  id: string;
  planId?: string;
  authorId?: string;
  authorName?: string;
  source?: string;
  type: PlanAnnotationKind;
  status: PlanAnnotationStatus;
  body?: string;
  replacementText?: string;
  anchor: PlanTextAnchor;
  createdAt: number;
  updatedAt: number;
  submittedAt?: number;
  resolvedAt?: number;
  writebackId?: string;
}

const CONTEXT_CHARS = 80;

type CreatePlanTextAnchorOptions = {
  occurrenceIndex?: number;
};

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function createPlanTextAnchor(
  content: string,
  selectedText: string,
  options?: CreatePlanTextAnchorOptions,
): PlanTextAnchor {
  const contentHash = hashString(content);
  const quote = selectedText.trim();
  if (!quote) return { contentHash };

  const occurrenceIndex = Math.max(0, Math.floor(options?.occurrenceIndex ?? 0));
  let exactOffset = -1;
  let searchFrom = 0;
  for (let occurrence = 0; occurrence <= occurrenceIndex; occurrence++) {
    exactOffset = content.indexOf(quote, searchFrom);
    if (exactOffset < 0) break;
    searchFrom = exactOffset + quote.length;
  }
  if (exactOffset >= 0) {
    return {
      quote,
      startOffset: exactOffset,
      endOffset: exactOffset + quote.length,
      occurrenceIndex,
      prefix: content.slice(Math.max(0, exactOffset - CONTEXT_CHARS), exactOffset),
      suffix: content.slice(exactOffset + quote.length, exactOffset + quote.length + CONTEXT_CHARS),
      contentHash,
    };
  }

  // Normalized offsets cannot be applied to the original content string.
  return {
    quote,
    occurrenceIndex,
    contentHash,
  };
}
