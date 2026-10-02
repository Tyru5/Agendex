import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReviewCard } from './TeamReviews';

type Review = Parameters<typeof ReviewCard>[0]['review'];
const review = {
  id: 'request-id' as Review['id'],
  planId: 'plan-id' as Review['planId'],
  title: 'Authentication plan',
  reviewerName: 'alice@example.com',
  planVersion: 7,
  status: 'pending',
  message: 'Review workspace authorization',
  decisionNote: null,
  createdAt: 1,
  updatedAt: 2,
  unread: true,
  canDecide: true,
  canCancel: false,
} satisfies Review;
const action = async () => {};

test('assigned pending review identifies exact revision and requires a note before requesting changes', () => {
  const html = renderToStaticMarkup(<ReviewCard review={review} onAction={action} />);
  expect(html).toContain('Approve revision 7');
  expect(html).toContain('Review note (required for changes)');
  expect(html).toMatch(/disabled=""[^>]*>Request changes/);
  expect(html).toContain('Unread');
  expect(html).not.toContain('Cancel request');
});

test('superseded or removed-member review offers no stale approval control', () => {
  for (const status of ['superseded', 'cancelled'] as const) {
    const html = renderToStaticMarkup(
      <ReviewCard
        review={{ ...review, status, canDecide: false, canCancel: false }}
        onAction={action}
      />,
    );
    expect(html).not.toContain('Approve revision');
    expect(html).not.toContain('Request changes');
    expect(html).not.toContain('<textarea');
    expect(html).toContain('Mark read');
  }
});

test('owner review card provides cancellation, and request and decision notes render as text', () => {
  const html = renderToStaticMarkup(
    <ReviewCard
      review={{
        ...review,
        canDecide: false,
        canCancel: true,
        message: '<script>request()</script>',
        decisionNote: '<img src=x onerror=bad()>',
      }}
      onAction={action}
    />,
  );
  expect(html).toContain('Cancel request');
  expect(html).not.toContain('Approve revision');
  expect(html).toContain('&lt;script&gt;');
  expect(html).toContain('&lt;img');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('<img');
});
