import { expect, test } from 'bun:test';
import { formatReceiptCounts, receiptTagStatus } from './plan-receipt-format.ts';

test('formatReceiptCounts reads as changed/mentioned files and commits', () => {
  expect(formatReceiptCounts({ changedFiles: 7, mentionedFiles: 9, commits: 4 })).toBe(
    '7/9 files · 4 commits',
  );
  expect(formatReceiptCounts({ changedFiles: 1, mentionedFiles: 1, commits: 1 })).toBe(
    '1/1 file · 1 commit',
  );
});

test('formatReceiptCounts drops the file ratio when no files are trackable', () => {
  expect(formatReceiptCounts({ changedFiles: 0, mentionedFiles: 0, commits: 2 })).toBe('2 commits');
});

test('only landed, in-progress, and stalled receipts earn a list tag', () => {
  expect(receiptTagStatus({ status: 'landed' })).toBe('landed');
  expect(receiptTagStatus({ status: 'in-progress' })).toBe('in-progress');
  expect(receiptTagStatus({ status: 'stalled' })).toBe('stalled');
  expect(receiptTagStatus({ status: 'planned' })).toBeUndefined();
  expect(receiptTagStatus({ status: 'unavailable' })).toBeUndefined();
  expect(receiptTagStatus(undefined)).toBeUndefined();
});
