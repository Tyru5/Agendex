import { expect, test } from 'bun:test';
import {
  MAX_PLANS_PER_TAG_QUERY,
  MAX_TAGS_PER_PLAN,
  normalizeBoundedIds,
  requireOwnedDocuments,
} from './planTags';

test('normalizeBoundedIds deduplicates and sorts valid bulk inputs deterministically', () => {
  expect(normalizeBoundedIds(['tag-c', 'tag-a', 'tag-c', 'tag-b'], MAX_TAGS_PER_PLAN, 'tags'))
    .toEqual(['tag-a', 'tag-b', 'tag-c']);
});

test('normalizeBoundedIds bounds the raw request even when it only repeats one id', () => {
  const repeatedPlanIds = Array.from({ length: MAX_PLANS_PER_TAG_QUERY + 1 }, () => 'plan-a');

  expect(() =>
    normalizeBoundedIds(repeatedPlanIds, MAX_PLANS_PER_TAG_QUERY, 'plans in a tag query'),
  ).toThrow(`maximum is ${MAX_PLANS_PER_TAG_QUERY}`);
});

test('requireOwnedDocuments rejects a mixed-owner plan array', () => {
  expect(() =>
    requireOwnedDocuments(
      [{ ownerId: 'owner-a' }, { ownerId: 'owner-b' }],
      'owner-a',
      'Plan',
    ),
  ).toThrow('Plan not found');
});

test('requireOwnedDocuments rejects a guessed plan id without revealing whether it exists', () => {
  expect(() => requireOwnedDocuments([null], 'owner-a', 'Plan')).toThrow('Plan not found');
});

test('requireOwnedDocuments rejects foreign tags from a mixed-owner bulk update', () => {
  expect(() =>
    requireOwnedDocuments(
      [{ ownerId: 'owner-a' }, { ownerId: 'owner-b' }],
      'owner-a',
      'Tag',
    ),
  ).toThrow('Tag not found');
});

test('requireOwnedDocuments returns valid same-owner documents in request order', () => {
  const documents = [
    { ownerId: 'owner-a', value: 'first' },
    { ownerId: 'owner-a', value: 'second' },
  ];

  expect(requireOwnedDocuments(documents, 'owner-a', 'Tag')).toEqual(documents);
});
