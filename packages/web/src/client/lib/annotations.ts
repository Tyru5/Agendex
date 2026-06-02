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

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function createPlanTextAnchor(content: string, selectedText: string): PlanTextAnchor {
  const quote = selectedText.trim();
  if (!quote) return { contentHash: hashString(content) };

  const exactOffset = content.indexOf(quote);
  if (exactOffset >= 0) {
    return {
      quote,
      startOffset: exactOffset,
      endOffset: exactOffset + quote.length,
      prefix: content.slice(Math.max(0, exactOffset - CONTEXT_CHARS), exactOffset),
      suffix: content.slice(exactOffset + quote.length, exactOffset + quote.length + CONTEXT_CHARS),
      contentHash: hashString(content),
    };
  }

  const normalizedQuote = normalizeWhitespace(quote);
  const normalizedContent = normalizeWhitespace(content);
  const normalizedOffset = normalizedQuote ? normalizedContent.indexOf(normalizedQuote) : -1;

  return {
    quote,
    ...(normalizedOffset >= 0
      ? {
          startOffset: normalizedOffset,
          endOffset: normalizedOffset + normalizedQuote.length,
        }
      : {}),
    contentHash: hashString(content),
  };
}
