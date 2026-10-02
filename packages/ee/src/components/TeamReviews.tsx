import { useMutation, usePaginatedQuery, useQuery } from 'convex/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import type { FunctionReturnType } from 'convex/server';

type Review = FunctionReturnType<typeof api.teamReviews.inbox>['page'][number];
const buttonClass =
  'rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed';
const statusLabels = {
  pending: 'Pending review',
  approved: 'Approved',
  changes_requested: 'Changes requested',
  cancelled: 'Cancelled',
  superseded: 'Superseded by another revision',
};

/** Presentational card: approval always refers to the displayed revision. */
export function ReviewCard({
  review,
  onOpen,
  onAction,
}: {
  review: Review;
  onOpen?: (planId: string) => Promise<void>;
  onAction?: (
    action: 'approved' | 'changes_requested' | 'cancel' | 'read',
    note: string,
  ) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (action: 'approved' | 'changes_requested' | 'cancel' | 'read') => {
    if (!onAction) return;
    setBusy(true);
    setError(null);
    try {
      await onAction(action, note);
      setNote('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Review action failed');
    } finally {
      setBusy(false);
    }
  };
  const openPlan = async () => {
    setError(null);
    setBusy(true);
    try {
      await onOpen?.(review.planId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open plan');
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="rounded-lg border border-border p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {onOpen ? (
          <button
            type="button"
            className="text-sm font-medium underline text-left"
            disabled={busy}
            onClick={() => void openPlan()}
          >
            {review.title}
          </button>
        ) : null}
        <span className="text-sm font-medium">{statusLabels[review.status]}</span>
        <span className="text-xs text-secondary">
          Revision {review.planVersion} · {review.reviewerName}
        </span>
        {review.unread && <span className="text-xs text-primary">Unread</span>}
      </div>
      {review.message && <p className="text-sm whitespace-pre-wrap">{review.message}</p>}
      {review.decisionNote && (
        <p className="text-sm whitespace-pre-wrap">
          <strong>Reviewer note: </strong>
          {review.decisionNote}
        </p>
      )}
      {review.canDecide && onAction && (
        <>
          <label className="block text-sm">
            Review note (required for changes)
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={4000}
              rows={2}
              className="mt-1 w-full rounded-md border border-border bg-background p-2"
              disabled={busy}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => void act('approved')}
            >
              Approve revision {review.planVersion}
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={busy || !note.trim()}
              onClick={() => void act('changes_requested')}
            >
              Request changes
            </button>
          </div>
        </>
      )}
      {onAction && (
        <div className="flex gap-2">
          {review.canCancel && (
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => void act('cancel')}
            >
              Cancel request
            </button>
          )}
          {review.unread && (
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => void act('read')}
            >
              Mark read
            </button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
    </article>
  );
}

function useReviewActions() {
  const decide = useMutation(api.teamReviews.decide);
  const cancel = useMutation(api.teamReviews.cancel);
  const read = useMutation(api.teamReviews.markRead);
  return async (
    id: Id<'planReviewRequests'>,
    action: 'approved' | 'changes_requested' | 'cancel' | 'read',
    note: string,
  ) => {
    if (action === 'cancel') await cancel({ requestId: id });
    else if (action === 'read') await read({ requestId: id });
    else await decide({ requestId: id, decision: action, note });
  };
}

export function TeamReviewPlanPanel({ planId }: { planId: string }) {
  const id = planId as Id<'plans'>;
  const members = useQuery(api.teamReviews.eligibleReviewers, { planId: id });
  const { results, status, loadMore } = usePaginatedQuery(
    api.teamReviews.forPlan,
    { planId: id },
    { initialNumItems: 5 },
  );
  const request = useMutation(api.teamReviews.request);
  const act = useReviewActions();
  const [reviewers, setReviewers] = useState<string[]>([]);
  const selectedReviewers = new Set(reviewers);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await request({ planId: id, reviewerIds: reviewers, message });
      setReviewers([]);
      setMessage('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not request review');
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="border-b border-border px-5 py-3">
      <summary className="cursor-pointer text-sm font-medium">
        Team review {results.some((r) => r.status === 'pending') ? '· pending' : ''}
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-secondary">
          Reviews apply to one exact revision. Editing the plan requires a new review. Team review
          decisions do not resume an agent.
        </p>
        {members === undefined && (
          <p role="status" className="text-sm">
            Loading workspace reviewers…
          </p>
        )}
        {members && members.length > 0 && (
          <fieldset disabled={busy} className="space-y-2">
            <legend className="text-sm font-medium">Request review from workspace members</legend>
            {members.map((m) => (
              <label key={m.id} className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedReviewers.has(m.id)}
                  onChange={(e) =>
                    setReviewers((ids) =>
                      e.target.checked ? [...ids, m.id] : ids.filter((v) => v !== m.id),
                    )
                  }
                />
                {m.name}
              </label>
            ))}
            <label className="block text-sm">
              Request message
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={2}
                maxLength={4000}
                className="mt-1 w-full rounded-md border border-border bg-background p-2"
              />
            </label>
            <button
              type="button"
              className={buttonClass}
              disabled={busy || !reviewers.length || reviewers.length > 10}
              onClick={() => void send()}
            >
              Request review
            </button>
          </fieldset>
        )}
        {members?.length === 0 && results.length === 0 && (
          <p className="text-sm text-secondary">
            The plan owner can request review after adding workspace members in account settings.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
        {results.map((review) => (
          <ReviewCard
            key={review.id}
            review={review}
            onAction={(action, note) => act(review.id, action, note)}
          />
        ))}
        {status === 'LoadingFirstPage' && (
          <p role="status" className="text-sm">
            Loading reviews…
          </p>
        )}
        {status === 'CanLoadMore' && (
          <button type="button" className={buttonClass} onClick={() => loadMore(5)}>
            Load older reviews
          </button>
        )}
        {status === 'LoadingMore' && (
          <p role="status" className="text-sm">
            Loading older reviews…
          </p>
        )}
      </div>
    </details>
  );
}

function ReviewInboxDialog({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label="Team review inbox"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="fixed w-[min(42rem,calc(100vw-2rem))] max-h-[80vh] overflow-y-auto rounded-xl border border-border bg-background text-primary p-5 shadow-xl"
    >
      {children}
    </dialog>
  );
}

const INBOX_PAGE_SIZE = 5;
const MAX_AUTO_LOADS = 20;

/**
 * Inbox pages are filtered server-side after pagination (revoked access, deleted
 * plans), so a raw page can come back short or empty. Keep loading (bounded)
 * until the requested number of visible reviews is shown or history ends.
 */
function useInboxPages(direction: 'assigned' | 'sent') {
  const pages = usePaginatedQuery(
    api.teamReviews.inbox,
    { direction },
    { initialNumItems: INBOX_PAGE_SIZE },
  );
  const [target, setTarget] = useState(INBOX_PAGE_SIZE);
  const autoLoads = useRef(0);
  const { status, results, loadMore } = pages;
  useEffect(() => {
    if (status !== 'CanLoadMore' || results.length >= target) return;
    if (autoLoads.current >= MAX_AUTO_LOADS) return;
    autoLoads.current += 1;
    loadMore(INBOX_PAGE_SIZE);
  }, [status, results.length, target, loadMore]);
  const loadOlder = () => {
    autoLoads.current = 0;
    setTarget(results.length + INBOX_PAGE_SIZE);
    loadMore(INBOX_PAGE_SIZE);
  };
  return { ...pages, loadOlder };
}

export function TeamReviewInbox({ onOpenPlan }: { onOpenPlan: (planId: string) => Promise<void> }) {
  const assigned = useInboxPages('assigned');
  const sent = useInboxPages('sent');
  const act = useReviewActions();
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<'assigned' | 'sent'>('assigned');
  const active = direction === 'assigned' ? assigned : sent;
  const unread = [...assigned.results, ...sent.results].some((r) => r.unread);
  return (
    <>
      <button
        type="button"
        className="agendex-topbar-button agendex-topbar-control rounded-lg px-2 text-xs"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        Reviews{unread ? ' · unread' : ''}
      </button>
      {open && (
        <ReviewInboxDialog onClose={() => setOpen(false)}>
          <div className="flex justify-between items-center gap-3">
            <h2 className="text-lg font-semibold">Team reviews</h2>
            <button type="button" className={buttonClass} onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
          <div className="my-3 flex gap-2">
            <button
              type="button"
              className={buttonClass}
              aria-pressed={direction === 'assigned'}
              onClick={() => setDirection('assigned')}
            >
              Assigned to me
            </button>
            <button
              type="button"
              className={buttonClass}
              aria-pressed={direction === 'sent'}
              onClick={() => setDirection('sent')}
            >
              Requested by me
            </button>
          </div>
          <div className="space-y-3">
            {active.status === 'LoadingFirstPage' ? (
              <p role="status">Loading reviews…</p>
            ) : active.results.length === 0 && active.status === 'Exhausted' ? (
              <p className="text-secondary">No review requests.</p>
            ) : null}
            {active.results.map((review) => (
              <ReviewCard
                key={review.id}
                review={review}
                onOpen={async (id) => {
                  await onOpenPlan(id);
                  setOpen(false);
                }}
                onAction={(action, note) => act(review.id, action, note)}
              />
            ))}
            {active.status === 'CanLoadMore' && (
              <button type="button" className={buttonClass} onClick={active.loadOlder}>
                Load older reviews
              </button>
            )}
            {active.status === 'LoadingMore' && <p role="status">Loading older reviews…</p>}
          </div>
        </ReviewInboxDialog>
      )}
    </>
  );
}
