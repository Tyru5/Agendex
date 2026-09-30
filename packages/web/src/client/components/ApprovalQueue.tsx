import { useMemo, useEffect, useRef, useState } from 'react';
import type { ApprovalDecision, ApprovalSession } from '@agendex/shared/approval-gates';
import { api } from '../lib/api.ts';
import { createOrderedRefresh } from '../lib/ordered-refresh.ts';

export function ApprovalQueue() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<ApprovalSession[]>([]);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string>();
  const { refresh, invalidate } = useMemo(
    () =>
      createOrderedRefresh(
        () => api.getReviewSessions(),
        (result) => {
          setSessions(result.sessions);
          setError('');
        },
        (e) => setError(e instanceof Error ? e.message : 'Review queue unavailable'),
      ),
    [],
  );
  useEffect(() => {
    if (!open) return;
    const currentDialog = dialog.current;
    currentDialog?.showModal();
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => {
      invalidate();
      clearInterval(timer);
      currentDialog?.close();
    };
  }, [open, refresh, invalidate]);
  async function decide(session: ApprovalSession, decision: ApprovalDecision | 'cancel') {
    setBusy(session.id);
    setError('');
    try {
      if (decision === 'cancel') await api.cancelReview(session.id);
      else
        await api.decideReview(
          session.id,
          session.revision,
          decision,
          feedback[session.id]?.trim() || undefined,
        );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Decision failed');
    } finally {
      setBusy(undefined);
    }
  }
  return (
    <>
      <button
        type="button"
        className="agendex-topbar-button px-2 text-sm text-text"
        onClick={() => setOpen(true)}
      >
        Reviews
      </button>
      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        aria-labelledby="approval-queue-title"
        className="agendex-approval-dialog m-auto rounded-xl border border-border bg-surface text-text shadow-xl overflow-auto p-5 w-[min(900px,90vw)] max-h-[85vh]"
      >
        <div className="flex justify-between items-center gap-4 mb-3">
          <h2 id="approval-queue-title">Live plan reviews</h2>
          <button
            type="button"
            className="rounded border border-border px-3 py-1 text-text"
            onClick={() => setOpen(false)}
          >
            Close
          </button>
        </div>
        <p className="text-sm text-secondary mb-4">
          Decisions apply to the exact snapshot shown. This local queue requires the Agendex API
          token. Claude approval permits ExitPlanMode; manual review reports a decision to the
          waiting command.
        </p>
        {error && <p role="alert">{error}</p>}
        {sessions.length === 0 && <p>No live reviews. Waiting hooks appear here.</p>}
        {sessions.map((session) => (
          <section key={session.id} className="border border-border rounded-lg p-3 mb-3">
            <h3>{session.title}</h3>
            <p className="text-sm text-secondary">
              {session.agent} · {session.status.replaceAll('_', ' ')} · revision{' '}
              {session.revision.slice(0, 12)} ·{' '}
              {session.acknowledgedAt
                ? 'received by agent'
                : `expires ${new Date(session.expiresAt).toLocaleTimeString()}`}
            </p>
            <details>
              <summary>Review plan snapshot</summary>
              <pre className="whitespace-pre-wrap break-words text-sm max-h-[40vh] overflow-auto p-3">
                {session.content}
              </pre>
            </details>
            {session.feedback && <p className="whitespace-pre-wrap">{session.feedback}</p>}
            {session.status === 'pending' && (
              <>
                <label className="block mt-3">
                  Feedback
                  <textarea
                    className="block w-full border border-border rounded p-2 bg-surface text-text"
                    value={feedback[session.id] ?? ''}
                    maxLength={10000}
                    onChange={(e) =>
                      setFeedback((current) => ({ ...current, [session.id]: e.target.value }))
                    }
                  />
                </label>
                <div className="flex flex-wrap gap-3 mt-3">
                  <button
                    type="button"
                    className="rounded border border-border px-3 py-1 text-text disabled:opacity-40"
                    disabled={busy === session.id}
                    onClick={() => void decide(session, 'approved')}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="rounded border border-border px-3 py-1 text-text disabled:opacity-40"
                    disabled={busy === session.id || !feedback[session.id]?.trim()}
                    onClick={() => void decide(session, 'changes_requested')}
                  >
                    Request changes
                  </button>
                  <button
                    type="button"
                    className="rounded border border-border px-3 py-1 text-text disabled:opacity-40"
                    disabled={busy === session.id || !feedback[session.id]?.trim()}
                    onClick={() => void decide(session, 'rejected')}
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    className="rounded border border-border px-3 py-1 text-text disabled:opacity-40"
                    disabled={busy === session.id}
                    onClick={() => void decide(session, 'cancel')}
                  >
                    Cancel review
                  </button>
                </div>
              </>
            )}
          </section>
        ))}
      </dialog>
    </>
  );
}
