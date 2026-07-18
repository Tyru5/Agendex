import { expect, test } from 'bun:test';
import { buildDiffSegments, computeDiffLines, formatHunkHeader, hasDiffChanges } from './planDiff';

test('computeDiffLines marks additions, removals, and unchanged lines with numbers', () => {
  const lines = computeDiffLines('a\nb\nc\n', 'a\nx\nc\n');
  expect(lines).toEqual([
    { type: 'unchanged', content: 'a', oldLineNumber: 1, newLineNumber: 1 },
    { type: 'removed', content: 'b', oldLineNumber: 2, newLineNumber: null },
    { type: 'added', content: 'x', oldLineNumber: null, newLineNumber: 2 },
    { type: 'unchanged', content: 'c', oldLineNumber: 3, newLineNumber: 3 },
    { type: 'unchanged', content: '', oldLineNumber: 4, newLineNumber: 4 },
  ]);
  expect(hasDiffChanges(lines)).toBe(true);
});

test('computeDiffLines returns only unchanged lines when texts match', () => {
  const lines = computeDiffLines('hello\n', 'hello\n');
  expect(hasDiffChanges(lines)).toBe(false);
  expect(lines).toEqual([
    { type: 'unchanged', content: 'hello', oldLineNumber: 1, newLineNumber: 1 },
    { type: 'unchanged', content: '', oldLineNumber: 2, newLineNumber: 2 },
  ]);
});

test('buildDiffSegments creates git-style hunks with collapsed context', () => {
  const oldText = Array.from({ length: 20 }, (_, i) => `line-${i + 1}`).join('\n');
  const newLines = Array.from({ length: 20 }, (_, i) => `line-${i + 1}`);
  newLines[9] = 'changed-10';
  const lines = computeDiffLines(oldText, newLines.join('\n'));
  const segments = buildDiffSegments(lines, 2);

  expect(segments[0]?.kind).toBe('collapsed');
  expect(segments.some((s) => s.kind === 'hunk')).toBe(true);

  const hunk = segments.find((s) => s.kind === 'hunk');
  if (!hunk || hunk.kind !== 'hunk') throw new Error('expected hunk');
  expect(formatHunkHeader(hunk.hunk)).toBe('@@ -8,5 +8,5 @@');
  expect(hunk.hunk.lines.some((l) => l.type === 'removed' && l.content === 'line-10')).toBe(true);
  expect(hunk.hunk.lines.some((l) => l.type === 'added' && l.content === 'changed-10')).toBe(true);
});

test('buildDiffSegments collapses identical files into one segment', () => {
  const lines = computeDiffLines('a\nb\n', 'a\nb\n');
  const segments = buildDiffSegments(lines);
  expect(segments).toHaveLength(1);
  expect(segments[0]?.kind).toBe('collapsed');
});
