import { describe, expect, test } from 'bun:test';
import {
  annotationToPlannotator,
  createPlanAnnotationRecord,
  createPlanTextAnchor,
  formatPlanAnnotationFeedback,
} from './annotations.ts';

describe('plan annotations', () => {
  test('creates stable text anchors with offsets and context', () => {
    const content = 'First line\nSecond target line\nThird line';
    const anchor = createPlanTextAnchor(content, 'Second target line');

    const startOffset = content.indexOf('Second target line');

    expect(anchor.quote).toBe('Second target line');
    expect(anchor.startOffset).toBe(startOffset);
    expect(anchor.endOffset).toBe(startOffset + 'Second target line'.length);
    expect(anchor.contentHash).toBeTruthy();
  });

  test('anchors duplicate text with the selected occurrence index', () => {
    const content = 'repeat this. Then repeat this.';
    const anchor = createPlanTextAnchor(content, 'repeat this', { occurrenceIndex: 1 });

    const startOffset = content.lastIndexOf('repeat this');

    expect(anchor.occurrenceIndex).toBe(1);
    expect(anchor.startOffset).toBe(startOffset);
    expect(anchor.endOffset).toBe(startOffset + 'repeat this'.length);
  });

  test('omits offsets when only normalized whitespace matches', () => {
    const anchor = createPlanTextAnchor('First line\nSecond target line', 'First line Second');

    expect(anchor.quote).toBe('First line Second');
    expect(anchor.startOffset).toBeUndefined();
    expect(anchor.endOffset).toBeUndefined();
    expect(anchor.contentHash).toBeTruthy();
  });

  test('formats annotation feedback for agents', () => {
    const annotation = createPlanAnnotationRecord(
      {
        type: 'replacement',
        anchor: createPlanTextAnchor('Use legacy hooks', 'legacy hooks'),
        body: 'Prefer native lifecycle hooks.',
        replacementText: 'native lifecycle hooks',
      },
      { id: 'ann-1', now: 10, authorName: 'Tiru' },
    );

    expect(formatPlanAnnotationFeedback([annotation])).toContain('REPLACEMENT');
    expect(formatPlanAnnotationFeedback([annotation])).toContain('legacy hooks');
    expect(formatPlanAnnotationFeedback([annotation])).toContain('native lifecycle hooks');
  });

  test('converts annotations to Plannotator feedback payloads', () => {
    const annotation = createPlanAnnotationRecord(
      {
        type: 'comment',
        anchor: createPlanTextAnchor('Add Codex support', 'Codex support'),
        body: 'Codex hooks are required.',
      },
      { id: 'ann-2', now: 20, authorName: 'Tiru' },
    );

    expect(annotationToPlannotator(annotation)).toMatchObject({
      id: 'ann-2',
      type: 'COMMENT',
      text: 'Codex hooks are required.',
      originalText: 'Codex support',
      author: 'Tiru',
    });
  });

  test('rejects inline annotations without selected text', () => {
    expect(() =>
      createPlanAnnotationRecord({
        type: 'comment',
        anchor: {},
        body: 'This cannot be anchored.',
      }),
    ).toThrow('Selected text is required for inline annotations');
  });

  test('rejects directly-created submitted annotations', () => {
    expect(() =>
      createPlanAnnotationRecord({
        type: 'global_comment',
        status: 'submitted',
        anchor: {},
        body: 'Send this through a write-back instead.',
      }),
    ).toThrow('Use a write-back to submit annotations');
  });

  test('sets resolvedAt when creating resolved annotations', () => {
    const annotation = createPlanAnnotationRecord(
      {
        type: 'global_comment',
        status: 'resolved',
        anchor: {},
        body: 'Already handled.',
      },
      { now: 40 },
    );

    expect(annotation.resolvedAt).toBe(40);
  });
});
