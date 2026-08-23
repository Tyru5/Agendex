import { expect, test } from 'bun:test';
import {
  buildDiffSections,
  DIFF_CONTEXT_LINES,
  diffLineWords,
  diffPlanContent,
  type DiffBlock,
} from './plan-diff.ts';

function changedBlocks(blocks: DiffBlock[]) {
  return blocks.filter((block) => block.type === 'changed');
}

test('identical documents produce a single same block', () => {
  const content = '# Plan\n\n- step one\n- step two\n';
  const diff = diffPlanContent(content, content);
  expect(diff.identical).toBe(true);
  expect(diff.stats.added).toBe(0);
  expect(diff.stats.removed).toBe(0);
  expect(diff.stats.similarity).toBe(1);
  expect(diff.blocks).toHaveLength(1);
  expect(diff.blocks[0]?.type).toBe('same');
});

test('pure insertion is reported as added lines only', () => {
  const a = 'alpha\nbeta\n';
  const b = 'alpha\nmiddle\nbeta\n';
  const diff = diffPlanContent(a, b);
  expect(diff.stats.added).toBe(1);
  expect(diff.stats.removed).toBe(0);
  const changed = changedBlocks(diff.blocks);
  expect(changed).toHaveLength(1);
  expect(changed[0]?.type === 'changed' && changed[0].added[0]?.text).toBe('middle');
});

test('pure deletion is reported as removed lines only', () => {
  const a = 'alpha\nmiddle\nbeta\n';
  const b = 'alpha\nbeta\n';
  const diff = diffPlanContent(a, b);
  expect(diff.stats.added).toBe(0);
  expect(diff.stats.removed).toBe(1);
});

test('empty and non-empty documents diff cleanly', () => {
  const diff = diffPlanContent('', 'one\ntwo\n');
  expect(diff.stats.added).toBe(2);
  expect(diff.stats.removed).toBe(1); // the single empty line of A
  const reverse = diffPlanContent('one\ntwo\n', '');
  expect(reverse.stats.removed).toBe(2);
});

test('both documents empty are identical', () => {
  const diff = diffPlanContent('', '');
  expect(diff.identical).toBe(true);
  expect(diff.stats.similarity).toBe(1);
});

test('crlf and lf documents with equal text are identical', () => {
  const diff = diffPlanContent('a\r\nb\r\n', 'a\nb\n');
  expect(diff.identical).toBe(true);
});

test('unique lines anchor the diff around repeated boilerplate', () => {
  const a = ['# Title', '', 'intro', '', '## Setup', '', 'old detail', ''].join('\n');
  const b = ['# Title', '', 'intro', '', '## Setup', '', 'new detail', '', '## Extra', ''].join(
    '\n',
  );
  const diff = diffPlanContent(a, b);
  // "old detail" -> "new detail" plus the appended section.
  expect(diff.stats.removed).toBe(1);
  expect(diff.stats.added).toBeGreaterThanOrEqual(3);
  const changed = changedBlocks(diff.blocks);
  const replaced = changed.find(
    (block) => block.type === 'changed' && block.removed.some((l) => l.text === 'old detail'),
  );
  expect(replaced).toBeDefined();
});

test('replaced line pairs carry word segments', () => {
  const a = 'Refactor the auth module to use tokens\n';
  const b = 'Refactor the auth module to use sessions\n';
  const diff = diffPlanContent(a, b);
  const changed = changedBlocks(diff.blocks);
  expect(changed).toHaveLength(1);
  if (changed[0]?.type !== 'changed') throw new Error('expected changed block');
  const removed = changed[0].removed[0];
  const added = changed[0].added[0];
  expect(removed?.segments?.some((s) => s.type === 'del' && s.text.includes('tokens'))).toBe(true);
  expect(added?.segments?.some((s) => s.type === 'add' && s.text.includes('sessions'))).toBe(true);
  // Shared prefix stays a same segment.
  expect(removed?.segments?.[0]?.type).toBe('same');
});

test('dissimilar replaced lines skip word segments', () => {
  const segments = diffLineWords(
    'completely different original text here',
    'zzz qqq vvv unrelated words entirely',
  );
  expect(segments).toBeNull();
});

test('word segments merge adjacent runs of the same type', () => {
  const segments = diffLineWords('keep one two keep', 'keep three four keep');
  expect(segments).not.toBeNull();
  if (!segments) return;
  const delRun = segments.removed.filter((s) => s.type === 'del');
  expect(delRun).toHaveLength(1);
  expect(delRun[0]?.text).toBe('one two');
});

test('line numbers are 1-based and track each source', () => {
  const a = 'same\nremoved\n';
  const b = 'same\nadded one\nadded two\n';
  const diff = diffPlanContent(a, b);
  const changed = changedBlocks(diff.blocks);
  if (changed[0]?.type !== 'changed') throw new Error('expected changed block');
  expect(changed[0].removed[0]?.line).toBe(2);
  expect(changed[0].added[0]?.line).toBe(2);
  expect(changed[0].added[1]?.line).toBe(3);
});

test('similarity reflects the unchanged share of the larger document', () => {
  const a = 'a\nb\nc\nd\n';
  const b = 'a\nb\nc\nX\n';
  const diff = diffPlanContent(a, b);
  expect(diff.stats.similarity).toBeCloseTo(0.75);
});

test('buildDiffSections collapses long unchanged runs with context', () => {
  const middle = Array.from({ length: 30 }, (_, i) => `line ${i}`);
  const a = ['start-old', ...middle, 'end-old'].join('\n');
  const b = ['start-new', ...middle, 'end-new'].join('\n');
  const diff = diffPlanContent(a, b);
  const sections = buildDiffSections(diff.blocks);
  const collapsed = sections.filter((section) => section.type === 'collapsed');
  expect(collapsed).toHaveLength(1);
  if (collapsed[0]?.type !== 'collapsed') throw new Error('expected collapsed section');
  expect(collapsed[0].lines.length).toBe(30 - 2 * DIFF_CONTEXT_LINES);
});

test('buildDiffSections keeps edge unchanged runs without inner context', () => {
  const head = Array.from({ length: 30 }, (_, i) => `head ${i}`);
  const a = [...head, 'tail-old'].join('\n');
  const b = [...head, 'tail-new'].join('\n');
  const diff = diffPlanContent(a, b);
  const sections = buildDiffSections(diff.blocks);
  const collapsed = sections.find((section) => section.type === 'collapsed');
  expect(collapsed).toBeDefined();
  if (collapsed?.type !== 'collapsed') throw new Error('expected collapsed section');
  // First block only needs trailing context before the change.
  expect(collapsed.lines.length).toBe(30 - DIFF_CONTEXT_LINES);
});

test('short unchanged runs stay fully visible', () => {
  const a = 'change-a\none\ntwo\nthree\nchange-b\n';
  const b = 'CHANGE-a\none\ntwo\nthree\nCHANGE-b\n';
  const diff = diffPlanContent(a, b);
  const sections = buildDiffSections(diff.blocks);
  expect(sections.every((section) => section.type === 'visible')).toBe(true);
});

test('large dissimilar documents fall back without word-level work', () => {
  const a = Array.from({ length: 800 }, (_, i) => `alpha ${i} ${i % 7}`).join('\n');
  const b = Array.from({ length: 800 }, (_, i) => `omega ${i} ${i % 5}`).join('\n');
  const start = performance.now();
  const diff = diffPlanContent(a, b);
  const elapsed = performance.now() - start;
  expect(diff.stats.removed).toBe(800);
  expect(diff.stats.added).toBe(800);
  expect(elapsed).toBeLessThan(2000);
});

test('reordered sections resolve as move-style changes, not full rewrite', () => {
  const sectionOne = ['## One', 'alpha content', ''];
  const sectionTwo = ['## Two', 'beta content', ''];
  const a = [...sectionOne, ...sectionTwo].join('\n');
  const b = [...sectionTwo, ...sectionOne].join('\n');
  const diff = diffPlanContent(a, b);
  // One of the sections should survive unchanged.
  expect(diff.stats.unchanged).toBeGreaterThanOrEqual(2);
});
