/**
 * Line-oriented plan diff with word-level refinement.
 *
 * Patience algorithm on lines (unique-line anchors + LIS), with an LCS
 * fallback for small ambiguous ranges so repeated markdown boilerplate
 * (blank lines, fences) still aligns well. Changed blocks pair removed
 * and added lines positionally and compute word segments when the pair
 * is similar enough to make intra-line highlights meaningful.
 */

export type DiffWordSegment = {
  type: 'same' | 'add' | 'del';
  text: string;
};

export type DiffLine = {
  text: string;
  /** 1-based line number in its source document. */
  line: number;
  /** Word-level segments when this line pairs with a similar counterpart. */
  segments?: DiffWordSegment[];
};

export type DiffBlock =
  | { type: 'same'; lines: { text: string; aLine: number; bLine: number }[] }
  | { type: 'changed'; removed: DiffLine[]; added: DiffLine[] };

export type PlanDiffStats = {
  added: number;
  removed: number;
  unchanged: number;
  /** Share of the larger document that is unchanged, in [0, 1]. */
  similarity: number;
};

export type PlanDiff = {
  blocks: DiffBlock[];
  stats: PlanDiffStats;
  identical: boolean;
};

/** Ranges above this area use whole-block replacement instead of LCS. */
const LCS_FALLBACK_MAX_AREA = 40_000;
/** Skip word segments when either line has more tokens than this. */
const WORD_DIFF_MAX_TOKENS = 400;
/** Minimum shared-token ratio for a line pair to get word segments. */
const WORD_DIFF_MIN_SIMILARITY = 0.25;

function splitLines(content: string): string[] {
  const normalized = content.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  // A trailing newline produces one phantom empty line; drop it so the
  // diff reflects visible lines only.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

type RawOp = { type: 'same' | 'del' | 'add'; aIndex: number; bIndex: number };

/** Longest increasing subsequence over `values`; returns selected indices. */
function longestIncreasingSubsequence(values: number[]): number[] {
  const tailIndices: number[] = [];
  const prev = Array.from({ length: values.length }, () => -1);
  for (let i = 0; i < values.length; i++) {
    const value = values[i] ?? 0;
    let lo = 0;
    let hi = tailIndices.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const tailValue = values[tailIndices[mid] ?? 0] ?? 0;
      if (tailValue < value) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tailIndices[lo - 1] ?? -1;
    tailIndices[lo] = i;
  }
  const result: number[] = [];
  let k = tailIndices.length > 0 ? (tailIndices[tailIndices.length - 1] ?? -1) : -1;
  while (k >= 0) {
    result.push(k);
    k = prev[k] ?? -1;
  }
  result.reverse();
  return result;
}

/** Classic LCS via dynamic programming; only used for small ranges. */
function lcsOps(
  a: string[],
  aStart: number,
  aEnd: number,
  b: string[],
  bStart: number,
  bEnd: number,
  out: RawOp[],
): void {
  const n = aEnd - aStart;
  const m = bEnd - bStart;
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        a[aStart + i] === b[bStart + j]
          ? (table[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[aStart + i] === b[bStart + j]) {
      out.push({ type: 'same', aIndex: aStart + i, bIndex: bStart + j });
      i++;
      j++;
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) {
      out.push({ type: 'del', aIndex: aStart + i, bIndex: -1 });
      i++;
    } else {
      out.push({ type: 'add', aIndex: -1, bIndex: bStart + j });
      j++;
    }
  }
  while (i < n) {
    out.push({ type: 'del', aIndex: aStart + i, bIndex: -1 });
    i++;
  }
  while (j < m) {
    out.push({ type: 'add', aIndex: -1, bIndex: bStart + j });
    j++;
  }
}

function emitReplace(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
  out: RawOp[],
): void {
  for (let i = aStart; i < aEnd; i++) out.push({ type: 'del', aIndex: i, bIndex: -1 });
  for (let j = bStart; j < bEnd; j++) out.push({ type: 'add', aIndex: -1, bIndex: j });
}

function patienceOps(
  a: string[],
  aStart: number,
  aEnd: number,
  b: string[],
  bStart: number,
  bEnd: number,
  out: RawOp[],
): void {
  // Trim common prefix.
  while (aStart < aEnd && bStart < bEnd && a[aStart] === b[bStart]) {
    out.push({ type: 'same', aIndex: aStart, bIndex: bStart });
    aStart++;
    bStart++;
  }
  // Trim common suffix (recorded after the middle is resolved).
  const suffix: RawOp[] = [];
  while (aEnd > aStart && bEnd > bStart && a[aEnd - 1] === b[bEnd - 1]) {
    suffix.push({ type: 'same', aIndex: aEnd - 1, bIndex: bEnd - 1 });
    aEnd--;
    bEnd--;
  }
  suffix.reverse();

  if (aStart === aEnd || bStart === bEnd) {
    emitReplace(aStart, aEnd, bStart, bEnd, out);
    out.push(...suffix);
    return;
  }

  // Lines occurring exactly once on each side become anchors.
  const aCounts = new Map<string, { count: number; index: number }>();
  for (let i = aStart; i < aEnd; i++) {
    const line = a[i] ?? '';
    const entry = aCounts.get(line);
    if (entry) entry.count++;
    else aCounts.set(line, { count: 1, index: i });
  }
  const bCounts = new Map<string, { count: number; index: number }>();
  for (let j = bStart; j < bEnd; j++) {
    const line = b[j] ?? '';
    const entry = bCounts.get(line);
    if (entry) entry.count++;
    else bCounts.set(line, { count: 1, index: j });
  }
  const candidates: { aIndex: number; bIndex: number }[] = [];
  for (let i = aStart; i < aEnd; i++) {
    const line = a[i] ?? '';
    const aEntry = aCounts.get(line);
    if (!aEntry || aEntry.count !== 1) continue;
    const bEntry = bCounts.get(line);
    if (!bEntry || bEntry.count !== 1) continue;
    candidates.push({ aIndex: i, bIndex: bEntry.index });
  }

  const anchorPicks = longestIncreasingSubsequence(candidates.map((c) => c.bIndex));

  if (anchorPicks.length === 0) {
    if ((aEnd - aStart) * (bEnd - bStart) <= LCS_FALLBACK_MAX_AREA) {
      lcsOps(a, aStart, aEnd, b, bStart, bEnd, out);
    } else {
      emitReplace(aStart, aEnd, bStart, bEnd, out);
    }
    out.push(...suffix);
    return;
  }

  let prevA = aStart;
  let prevB = bStart;
  for (const pick of anchorPicks) {
    const anchor = candidates[pick];
    if (!anchor) continue;
    patienceOps(a, prevA, anchor.aIndex, b, prevB, anchor.bIndex, out);
    out.push({ type: 'same', aIndex: anchor.aIndex, bIndex: anchor.bIndex });
    prevA = anchor.aIndex + 1;
    prevB = anchor.bIndex + 1;
  }
  patienceOps(a, prevA, aEnd, b, prevB, bEnd, out);
  out.push(...suffix);
}

/** Tokenize a line into words and whitespace runs for intra-line diffing. */
function tokenizeLine(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

function mergeSegments(segments: DiffWordSegment[]): DiffWordSegment[] {
  // Whitespace-only same segments between two changes of one type read
  // better highlighted as part of that change (e.g. "one two" -> one run).
  const absorbed: DiffWordSegment[] = segments.map((segment) => ({ ...segment }));
  for (let i = 1; i < absorbed.length - 1; i++) {
    const current = absorbed[i];
    const before = absorbed[i - 1];
    const after = absorbed[i + 1];
    if (!current || !before || !after) continue;
    if (
      current.type === 'same' &&
      /^\s+$/.test(current.text) &&
      before.type === after.type &&
      before.type !== 'same'
    ) {
      current.type = before.type;
    }
  }

  const merged: DiffWordSegment[] = [];
  for (const segment of absorbed) {
    const last = merged[merged.length - 1];
    if (last && last.type === segment.type) last.text += segment.text;
    else merged.push(segment);
  }
  return merged;
}

/**
 * Word-level diff of a removed/added line pair. Returns null when the
 * lines are too long or too dissimilar for highlights to help.
 */
export function diffLineWords(
  removed: string,
  added: string,
): { removed: DiffWordSegment[]; added: DiffWordSegment[] } | null {
  const aTokens = tokenizeLine(removed);
  const bTokens = tokenizeLine(added);
  if (aTokens.length === 0 || bTokens.length === 0) return null;
  if (aTokens.length > WORD_DIFF_MAX_TOKENS || bTokens.length > WORD_DIFF_MAX_TOKENS) return null;

  const n = aTokens.length;
  const m = bTokens.length;
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        aTokens[i] === bTokens[j]
          ? (table[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
    }
  }

  const removedSegments: DiffWordSegment[] = [];
  const addedSegments: DiffWordSegment[] = [];
  let sharedWordChars = 0;
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const aToken = aTokens[i] ?? '';
    const bToken = bTokens[j] ?? '';
    if (aToken === bToken) {
      removedSegments.push({ type: 'same', text: aToken });
      addedSegments.push({ type: 'same', text: bToken });
      if (!/^\s+$/.test(aToken)) sharedWordChars += aToken.length;
      i++;
      j++;
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) {
      removedSegments.push({ type: 'del', text: aToken });
      i++;
    } else {
      addedSegments.push({ type: 'add', text: bToken });
      j++;
    }
  }
  while (i < n) {
    removedSegments.push({ type: 'del', text: aTokens[i] ?? '' });
    i++;
  }
  while (j < m) {
    addedSegments.push({ type: 'add', text: bTokens[j] ?? '' });
    j++;
  }

  const wordChars = Math.max(removed.replace(/\s+/g, '').length, added.replace(/\s+/g, '').length);
  if (wordChars === 0) return null;
  if (sharedWordChars / wordChars < WORD_DIFF_MIN_SIMILARITY) return null;

  return { removed: mergeSegments(removedSegments), added: mergeSegments(addedSegments) };
}

function buildBlocks(a: string[], b: string[], ops: RawOp[]): DiffBlock[] {
  const blocks: DiffBlock[] = [];
  let index = 0;
  while (index < ops.length) {
    const first = ops[index];
    if (!first) break;
    if (first.type === 'same') {
      const lines: { text: string; aLine: number; bLine: number }[] = [];
      for (let op = ops[index]; op && op.type === 'same'; op = ops[++index]) {
        lines.push({ text: a[op.aIndex] ?? '', aLine: op.aIndex + 1, bLine: op.bIndex + 1 });
      }
      blocks.push({ type: 'same', lines });
      continue;
    }

    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    for (let op = ops[index]; op && op.type !== 'same'; op = ops[++index]) {
      if (op.type === 'del') removed.push({ text: a[op.aIndex] ?? '', line: op.aIndex + 1 });
      else added.push({ text: b[op.bIndex] ?? '', line: op.bIndex + 1 });
    }

    const pairCount = Math.min(removed.length, added.length);
    for (let pair = 0; pair < pairCount; pair++) {
      const removedLine = removed[pair];
      const addedLine = added[pair];
      if (!removedLine || !addedLine) continue;
      const segments = diffLineWords(removedLine.text, addedLine.text);
      if (segments) {
        removedLine.segments = segments.removed;
        addedLine.segments = segments.added;
      }
    }
    blocks.push({ type: 'changed', removed, added });
  }
  return blocks;
}

/** Diffs two plan documents into aligned blocks plus summary stats. */
export function diffPlanContent(aContent: string, bContent: string): PlanDiff {
  const a = splitLines(aContent);
  const b = splitLines(bContent);

  const ops: RawOp[] = [];
  patienceOps(a, 0, a.length, b, 0, b.length, ops);
  const blocks = buildBlocks(a, b, ops);

  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (const block of blocks) {
    if (block.type === 'same') {
      unchanged += block.lines.length;
    } else {
      removed += block.removed.length;
      added += block.added.length;
    }
  }
  const larger = Math.max(a.length, b.length);
  const similarity = larger === 0 ? 1 : unchanged / larger;

  return {
    blocks,
    stats: { added, removed, unchanged, similarity },
    identical: added === 0 && removed === 0,
  };
}

export type DiffDisplaySection =
  | { type: 'visible'; block: DiffBlock }
  | {
      type: 'collapsed';
      /** Hidden unchanged lines; leading/trailing context already split out. */
      lines: { text: string; aLine: number; bLine: number }[];
      key: string;
    };

/** Context lines kept visible around changes when collapsing. */
export const DIFF_CONTEXT_LINES = 3;
/** Unchanged runs shorter than this render in full. */
export const DIFF_MIN_COLLAPSE = 10;

/**
 * Splits diff blocks into visible sections and collapsible unchanged
 * runs, keeping `DIFF_CONTEXT_LINES` of context around every change.
 */
export function buildDiffSections(blocks: DiffBlock[]): DiffDisplaySection[] {
  const sections: DiffDisplaySection[] = [];
  blocks.forEach((block, blockIndex) => {
    if (block.type === 'changed') {
      sections.push({ type: 'visible', block });
      return;
    }

    const isFirst = blockIndex === 0;
    const isLast = blockIndex === blocks.length - 1;
    const leading = isFirst ? 0 : DIFF_CONTEXT_LINES;
    const trailing = isLast ? 0 : DIFF_CONTEXT_LINES;

    if (block.lines.length < DIFF_MIN_COLLAPSE + leading + trailing) {
      sections.push({ type: 'visible', block });
      return;
    }

    if (leading > 0) {
      sections.push({
        type: 'visible',
        block: { type: 'same', lines: block.lines.slice(0, leading) },
      });
    }
    sections.push({
      type: 'collapsed',
      lines: block.lines.slice(leading, block.lines.length - trailing),
      key: `collapsed-${blockIndex}`,
    });
    if (trailing > 0) {
      sections.push({
        type: 'visible',
        block: { type: 'same', lines: block.lines.slice(block.lines.length - trailing) },
      });
    }
  });
  return sections;
}
