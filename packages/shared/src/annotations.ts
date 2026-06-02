import type { PlannotatorPlanAnnotation } from './types.ts';

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

export type CreatePlanAnnotationInput = Pick<PlanAnnotationRecord, 'type' | 'anchor'> &
  Partial<Pick<PlanAnnotationRecord, 'body' | 'replacementText' | 'source' | 'status'>>;

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

export function createPlanAnnotationRecord(
  input: CreatePlanAnnotationInput,
  options?: { id?: string; authorId?: string; authorName?: string; now?: number },
): PlanAnnotationRecord {
  const now = options?.now ?? Date.now();
  const randomId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `ann_${now}_${Math.random().toString(36).slice(2)}`;

  return {
    id: options?.id ?? randomId,
    authorId: options?.authorId,
    authorName: options?.authorName,
    source: input.source ?? 'agendex',
    type: input.type,
    status: input.status ?? 'open',
    body: input.body?.trim() || undefined,
    replacementText: input.replacementText?.trim() || undefined,
    anchor: input.anchor,
    createdAt: now,
    updatedAt: now,
  };
}

function annotationQuote(annotation: Pick<PlanAnnotationRecord, 'anchor'>): string | undefined {
  return annotation.anchor.quote?.trim() || undefined;
}

export function annotationToPlannotator(
  annotation: PlanAnnotationRecord,
): PlannotatorPlanAnnotation {
  const quote = annotationQuote(annotation);
  const base = {
    id: annotation.id,
    source: annotation.source ?? 'agendex',
    author: annotation.authorName ?? annotation.authorId,
    originalText: quote,
    blockId: annotation.anchor.contentHash,
    startOffset: annotation.anchor.startOffset,
    endOffset: annotation.anchor.endOffset,
    createdAt: annotation.createdAt,
  } satisfies Omit<PlannotatorPlanAnnotation, 'type'>;

  switch (annotation.type) {
    case 'replacement':
      return {
        ...base,
        type: 'REPLACEMENT',
        text: annotation.body,
        replacementText: annotation.replacementText,
      };
    case 'deletion':
      return {
        ...base,
        type: 'DELETION',
        text: annotation.body,
      };
    case 'insertion':
      return {
        ...base,
        type: 'INSERTION',
        text: annotation.body,
        insertionText: annotation.replacementText ?? annotation.body,
      };
    case 'global_comment':
      return {
        ...base,
        type: 'GLOBAL_COMMENT',
        text: annotation.body,
      };
    case 'comment':
    default:
      return {
        ...base,
        type: 'COMMENT',
        text: annotation.body,
      };
  }
}

export function formatPlanAnnotationFeedback(annotations: PlanAnnotationRecord[]): string {
  const actionable = annotations.filter((annotation) => annotation.status !== 'resolved');
  if (actionable.length === 0) return '';

  const lines = ['Agendex plan review feedback:', ''];
  actionable.forEach((annotation, index) => {
    const quote = annotationQuote(annotation);
    const label = annotation.type.replace('_', ' ');
    lines.push(`${index + 1}. ${label.toUpperCase()}`);
    if (quote) lines.push(`   Selected text: "${quote}"`);
    if (annotation.body) lines.push(`   Feedback: ${annotation.body}`);
    if (annotation.replacementText)
      lines.push(`   Suggested replacement: ${annotation.replacementText}`);
    lines.push('');
  });

  return lines.join('\n').trim();
}

export function toPlannotatorFeedbackAnnotations(
  annotations: PlanAnnotationRecord[],
): PlannotatorPlanAnnotation[] {
  return annotations
    .filter((annotation) => annotation.status !== 'resolved')
    .map(annotationToPlannotator);
}
