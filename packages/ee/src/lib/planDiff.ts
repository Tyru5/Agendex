export type DiffLineType = 'added' | 'removed' | 'unchanged';

export type DiffLine = {
  type: DiffLineType;
  content: string;
  /** 1-based line number in the old text, or null for pure additions. */
  oldLineNumber: number | null;
  /** 1-based line number in the new text, or null for pure deletions. */
  newLineNumber: number | null;
};

export type DiffHunk = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
};

export type DiffSegment =
  | { kind: 'hunk'; hunk: DiffHunk }
  | { kind: 'collapsed'; lines: DiffLine[] };

const DEFAULT_CONTEXT = 3;

/**
 * Myers' shortest-edit diff (see jcoglan's walkthrough).
 * Returns a unified line list with 1-based old/new line numbers.
 */
export function computeDiffLines(oldText: string, newText: string): DiffLine[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const n = a.length;
  const m = b.length;
  const max = n + m;

  if (max === 0) return [];

  // v[k] stores the furthest x reached on diagonal k. Offset by `max` so k can be negative.
  const offset = max;
  const v = new Int32Array(2 * max + 1);
  v[1 + offset] = 0;
  const trace: Int32Array[] = [];

  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      const idx = k + offset;
      let x: number;
      if (k === -d || (k !== d && v[idx - 1]! < v[idx + 1]!)) {
        x = v[idx + 1]!; // vertical move (insert)
      } else {
        x = v[idx - 1]! + 1; // horizontal move (delete)
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[idx] = x;
      if (x >= n && y >= m) {
        return backtrack(a, b, trace);
      }
    }
  }

  return [];
}

function backtrack(a: string[], b: string[], trace: Int32Array[]): DiffLine[] {
  const result: DiffLine[] = [];
  let x = a.length;
  let y = b.length;
  const offset = a.length + b.length;

  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d]!;
    const k = x - y;

    let prevK: number;
    if (k === -d || (k !== d && v[k - 1 + offset]! < v[k + 1 + offset]!)) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    const prevX = v[prevK + offset]!;
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      x--;
      y--;
      result.push({
        type: 'unchanged',
        content: a[x]!,
        oldLineNumber: x + 1,
        newLineNumber: y + 1,
      });
    }

    if (d === 0) break;

    if (x === prevX) {
      // vertical — insertion from b
      y--;
      result.push({
        type: 'added',
        content: b[y]!,
        oldLineNumber: null,
        newLineNumber: y + 1,
      });
    } else {
      // horizontal — deletion from a
      x--;
      result.push({
        type: 'removed',
        content: a[x]!,
        oldLineNumber: x + 1,
        newLineNumber: null,
      });
    }

    x = prevX;
    y = prevY;
  }

  result.reverse();
  return result;
}

/**
 * Group a full unified diff into git-style hunks with surrounding context.
 * Large unchanged stretches between hunks become expandable collapsed segments.
 */
export function buildDiffSegments(
  lines: DiffLine[],
  context: number = DEFAULT_CONTEXT,
): DiffSegment[] {
  if (lines.length === 0) return [];

  const changeIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.type !== 'unchanged') changeIndices.push(i);
  }

  if (changeIndices.length === 0) {
    return [{ kind: 'collapsed', lines }];
  }

  const ranges: Array<{ start: number; end: number }> = [];
  let rangeStart = Math.max(0, changeIndices[0]! - context);
  let rangeEnd = Math.min(lines.length, changeIndices[0]! + 1 + context);

  for (let i = 1; i < changeIndices.length; i++) {
    const idx = changeIndices[i]!;
    const nextStart = Math.max(0, idx - context);
    const nextEnd = Math.min(lines.length, idx + 1 + context);
    if (nextStart <= rangeEnd) {
      rangeEnd = Math.max(rangeEnd, nextEnd);
    } else {
      ranges.push({ start: rangeStart, end: rangeEnd });
      rangeStart = nextStart;
      rangeEnd = nextEnd;
    }
  }
  ranges.push({ start: rangeStart, end: rangeEnd });

  const segments: DiffSegment[] = [];
  let cursor = 0;

  for (const range of ranges) {
    if (range.start > cursor) {
      segments.push({ kind: 'collapsed', lines: lines.slice(cursor, range.start) });
    }
    const hunkLines = lines.slice(range.start, range.end);
    segments.push({ kind: 'hunk', hunk: toHunk(hunkLines) });
    cursor = range.end;
  }

  if (cursor < lines.length) {
    segments.push({ kind: 'collapsed', lines: lines.slice(cursor) });
  }

  return segments;
}

export function formatHunkHeader(hunk: DiffHunk): string {
  return `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`;
}

export function hasDiffChanges(lines: DiffLine[]): boolean {
  return lines.some((line) => line.type !== 'unchanged');
}

function toHunk(lines: DiffLine[]): DiffHunk {
  let oldCount = 0;
  let newCount = 0;
  let oldStart = 0;
  let newStart = 0;

  for (const line of lines) {
    if (line.type === 'removed' || line.type === 'unchanged') {
      oldCount++;
      if (oldStart === 0 && line.oldLineNumber != null) oldStart = line.oldLineNumber;
    }
    if (line.type === 'added' || line.type === 'unchanged') {
      newCount++;
      if (newStart === 0 && line.newLineNumber != null) newStart = line.newLineNumber;
    }
  }

  // Pure insertions/deletions: git uses 0 when that side contributes no lines.
  if (oldCount === 0) {
    const firstNew = lines.find((l) => l.newLineNumber != null)?.newLineNumber ?? 1;
    oldStart = Math.max(0, firstNew - 1);
  }
  if (newCount === 0) {
    const firstOld = lines.find((l) => l.oldLineNumber != null)?.oldLineNumber ?? 1;
    newStart = Math.max(0, firstOld - 1);
  }

  return { oldStart, oldCount, newStart, newCount, lines };
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  return text.split('\n');
}
