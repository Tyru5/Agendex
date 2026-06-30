import type { PlannotatorMetadata } from '@agendex/shared';
import type { Plan } from '@agendex/web';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useMutation, useQuery } from 'convex/react';
import { useEffect, useMemo, useState } from 'react';
import { type DaemonDeviceInfo, useDaemonStatus } from '../hooks/useDaemonStatus.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * The deviceId of the daemon that synced this plan, stamped into
 * `metadata.agendexSync` by the CLI (see packages/cli/src/payload.ts). Used to
 * correlate a Plannotator loopback session with a live/stale daemon device so
 * we only surface an actionable "Open in Plannotator" link when the originating
 * machine is still online.
 */
function getSyncDeviceId(plan: Plan): string | undefined {
  if (!isRecord(plan.metadata)) return undefined;
  const sync = plan.metadata.agendexSync;
  if (!isRecord(sync)) return undefined;
  return typeof sync.deviceId === 'string' ? sync.deviceId : undefined;
}

function getSyncHostname(plan: Plan): string | undefined {
  if (!isRecord(plan.metadata)) return undefined;
  const sync = plan.metadata.agendexSync;
  if (!isRecord(sync)) return undefined;
  return typeof sync.hostname === 'string' ? sync.hostname : undefined;
}

type OpenLiveness =
  | { state: 'open'; hostname?: string }
  | { state: 'offline'; reason: 'session-ended' | 'device-offline'; hostname?: string };

/**
 * Decide whether the Plannotator loopback URL is worth offering as a live link.
 *
 * Two independent signals gate this:
 *   1. `metadata.plannotator.liveness === 'ended'` is authoritative — the daemon
 *      publishes it when the local Plannotator process dies (see daemon.ts).
 *   2. Daemon device alive/stale status is a fallback for the case where the
 *      whole machine/daemon went offline before it could publish an end event.
 *      A loopback server is only reachable while its originating device is up.
 *
 * Device-liveness is NOT a sufficient signal on its own for a `live-session`: a
 * single Plannotator loopback process can die while the daemon device stays up
 * (and a session synced before liveness tracking existed has no `liveness` field
 * at all). We therefore require positive proof of liveness for live sessions and
 * only fall back to device status to *demote* an otherwise-live record.
 */
function resolveOpenLiveness(
  plan: Plan,
  metadata: PlannotatorMetadata,
  devices: DaemonDeviceInfo[],
  daemonStatus: 'alive' | 'stale' | 'unknown',
): OpenLiveness {
  const hostname = getSyncHostname(plan);

  // (1) Authoritative: the daemon told us the session ended.
  if (metadata.liveness === 'ended' || metadata.writebackCapable === false) {
    return { state: 'offline', reason: 'session-ended', hostname };
  }

  // (1b) A live-session loopback URL is only reachable while that specific
  // process is running. Demand positive proof — without it (e.g. a stale record
  // synced before liveness tracking, or a session whose PID died without the
  // daemon observing it), treat the session as ended regardless of device state.
  if (metadata.kind === 'live-session') {
    const provenLive = metadata.liveness === 'live' && metadata.writebackCapable === true;
    if (!provenLive) {
      return { state: 'offline', reason: 'session-ended', hostname };
    }
  }

  // (2) Fallback: correlate with the syncing daemon device's liveness. While
  // the daemon query is still loading, keep proven-live sessions open rather
  // than briefly claiming the Plannotator server is gone.
  if (daemonStatus === 'unknown') return { state: 'open', hostname };

  const deviceId = getSyncDeviceId(plan);
  const matched = deviceId ? devices.find((d) => d.deviceId === deviceId) : undefined;

  if (matched) {
    return matched.status === 'alive'
      ? { state: 'open', hostname: matched.hostname ?? hostname }
      : { state: 'offline', reason: 'device-offline', hostname: matched.hostname ?? hostname };
  }

  // No matching device record (deviceId absent or device pruned). Only treat the
  // session as openable if at least one daemon device is currently alive.
  const anyAlive = devices.some((d) => d.status === 'alive');
  return anyAlive
    ? { state: 'open', hostname }
    : { state: 'offline', reason: 'device-offline', hostname };
}

function getPlannotatorMetadata(plan: Plan): PlannotatorMetadata | undefined {
  if (!isRecord(plan.metadata)) return undefined;
  const value = plan.metadata.plannotator;
  if (!isRecord(value)) return undefined;
  if (value.kind !== 'snapshot' && value.kind !== 'live-session' && value.kind !== 'project-plan') {
    return undefined;
  }
  return value as unknown as PlannotatorMetadata;
}

function isSafeLoopbackUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:') return false;
    const host = url.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
}

function statusColor(status: string | undefined): string {
  if (status === 'approved' || status === 'sent') return 'var(--success)';
  if (status === 'denied' || status === 'failed') return 'var(--danger)';
  if (status === 'pending') return 'var(--warning)';
  return 'var(--secondary)';
}

function statusBorderColor(status: string | undefined): string {
  return `color-mix(in oklch, ${statusColor(status)} 42%, transparent)`;
}

// Shared interaction grammar (mirrors AuthButton/AuthPage): accent focus ring,
// 150ms ease-out, subtle press. Kept here so every Plannotator control behaves
// identically rather than each one reinventing hover/focus.
export const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color-mix(in_oklch,var(--accent)_55%,var(--border))]';
export const PRIMARY_BUTTON = `inline-flex items-center justify-center rounded-lg border-0 bg-[var(--accent)] px-3 py-1.5 text-[12px] font-semibold text-[var(--accent-contrast)] transition-[background-color,opacity,transform] duration-150 ease-out hover:bg-[color-mix(in_oklch,var(--accent)_88%,var(--text))] active:translate-y-px disabled:cursor-default disabled:opacity-50 disabled:hover:bg-[var(--accent)] ${FOCUS_RING}`;
export const GHOST_BUTTON = `inline-flex items-center justify-center rounded-md border border-border bg-transparent px-2 py-1 text-[11px] font-medium text-secondary transition-[background-color,border-color,color,transform] duration-150 ease-out hover:bg-hover hover:text-text active:translate-y-px ${FOCUS_RING}`;
export const DANGER_BUTTON = `inline-flex items-center justify-center rounded-md border border-border bg-transparent px-2 py-1 text-[11px] font-medium text-[var(--danger)] transition-[background-color,border-color,transform] duration-150 ease-out hover:border-[color-mix(in_oklch,var(--danger)_30%,var(--border))] hover:bg-[color-mix(in_oklch,var(--danger)_9%,transparent)] active:translate-y-px ${FOCUS_RING}`;
export const FIELD = `w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-[13px] leading-5 text-text outline-none transition-[border-color,box-shadow] duration-150 ease-out placeholder:text-secondary focus:border-[color-mix(in_oklch,var(--accent)_45%,var(--border))] focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--accent)_18%,transparent)]`;

type PlannotatorPanelVariant = 'stack' | 'rail';

function panelClassName(variant: PlannotatorPanelVariant): string {
  return `plannotator-panel plannotator-panel--${variant}`;
}

function StatusPill({ status }: { status: string | undefined }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-semibold capitalize"
      style={{ borderColor: statusBorderColor(status), color: statusColor(status) }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: statusColor(status) }} />
      {status}
    </span>
  );
}

export function CloudPlannotatorBadge({ plan }: { plan: Plan }) {
  const metadata = getPlannotatorMetadata(plan);
  const { aggregateStatus, devices } = useDaemonStatus();
  if (!metadata) return null;

  const isLiveKind = metadata.kind === 'live-session';
  const liveness = resolveOpenLiveness(plan, metadata, devices, aggregateStatus);
  const sessionOffline = isLiveKind && liveness.state === 'offline';
  const sessionEnded = sessionOffline && liveness.reason === 'session-ended';

  const label = isLiveKind
    ? sessionEnded
      ? 'Plannotator session ended'
      : sessionOffline
        ? 'Plannotator unavailable'
        : 'Plannotator live'
    : metadata.kind === 'project-plan'
      ? 'Plannotator project plan'
      : 'Plannotator snapshot';
  // Offline live sessions are no longer actionable; reflect that in the dot color.
  const status = sessionOffline
    ? 'unknown'
    : (metadata.status ?? (isLiveKind ? 'pending' : 'unknown'));

  const canOpen = liveness.state === 'open' && isSafeLoopbackUrl(metadata.url);
  // Only show open affordances at all when there is a loopback URL to open.
  const hasLoopbackUrl = isSafeLoopbackUrl(metadata.url);

  // The badge label already states the session ended, so this stays a short,
  // single-clause recovery note (no restated status, no em dash).
  const offlineHint =
    liveness.state === 'offline'
      ? liveness.reason === 'session-ended'
        ? liveness.hostname
          ? `Reopen the session on ${liveness.hostname}`
          : 'Reopen the Plannotator session to continue'
        : liveness.hostname
          ? `Start the originating machine (${liveness.hostname})`
          : 'Start the originating machine to continue'
      : undefined;

  const isLivePulse = isLiveKind && !sessionOffline;

  return (
    <div className="plan-plannotator-badge inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <span
        className="inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-semibold"
        style={{ borderColor: statusBorderColor(status), color: statusColor(status) }}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full${isLivePulse ? ' plannotator-live-dot' : ''}`}
          style={{ backgroundColor: statusColor(status) }}
        />
        {label}
      </span>
      <span className="text-[11px] text-tertiary">
        {metadata.origin ? `Origin: ${metadata.origin}` : 'Origin unknown'}
        {metadata.project ? ` · ${metadata.project}` : ''}
      </span>
      {hasLoopbackUrl &&
        (canOpen ? (
          <a
            href={metadata.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-secondary underline decoration-dotted underline-offset-4 transition-colors hover:text-text"
          >
            Open in Plannotator
            <span aria-hidden="true" className="text-[10px] leading-none">
              ↗
            </span>
          </a>
        ) : (
          offlineHint && (
            <span className="inline-flex items-center gap-1 text-[11px] text-tertiary">
              <span aria-hidden="true" className="text-[10px] leading-none opacity-70">
                ○
              </span>
              {offlineHint}
            </span>
          )
        ))}
    </div>
  );
}

export function CloudPlannotatorWritebackPanel({
  plan,
  canQueueWriteback = true,
  daemonAvailable = true,
  variant = 'stack',
}: {
  plan: Plan;
  canQueueWriteback?: boolean;
  daemonAvailable?: boolean;
  variant?: PlannotatorPanelVariant;
}) {
  const metadata = getPlannotatorMetadata(plan);
  const enqueueWriteback = useMutation(api.plannotator.enqueueWriteback);
  // `enqueueWriteback` resolves to the canonical live plan, which may differ
  // from the plan being displayed (e.g. a superseded row). Gate the actions on
  // that canonical plan's state so we never enable approve/request against a
  // stale row that the backend would reject or double-process.
  const canonicalState = useQuery(
    api.plannotator.getCanonicalWritebackState,
    metadata ? { planId: plan.id as Id<'plans'> } : 'skip',
  );
  // Read write-back history for the canonical plan once resolved: pending jobs
  // are remapped onto the canonical row when a session is superseded, so reading
  // the displayed (possibly superseded) row would show stale/missing history.
  const writebacks = useQuery(
    api.plannotator.listWritebacksForPlan,
    canonicalState
      ? { planId: canonicalState.canonicalPlanId }
      : metadata
        ? { planId: plan.id as Id<'plans'> }
        : 'skip',
  );
  const [feedback, setFeedback] = useState('');
  const [revisedContent, setRevisedContent] = useState('');
  const [submittingAction, setSubmittingAction] = useState<'approve' | 'request_changes' | null>(
    null,
  );
  const [error, setError] = useState<string>();
  const [queuedAction, setQueuedAction] = useState<'approve' | 'request_changes' | null>(null);

  const latest = useMemo(() => writebacks?.[0], [writebacks]);

  // Clear the local "queued" confirmation once the backend resolves the write-back
  // to a terminal state. Otherwise `queuedAction` stays set after a failed/sent
  // delivery, which would keep the actions disabled and suppress `latest.error`,
  // leaving the user unable to see the failure or retry.
  useEffect(() => {
    if (queuedAction && latest && latest.status !== 'pending') {
      setQueuedAction(null);
    }
  }, [queuedAction, latest]);

  // Prefer canonical state once loaded; fall back to the displayed plan's own
  // metadata/writebacks while it resolves.
  const isLive = canonicalState
    ? canonicalState.isLive
    : metadata?.kind === 'live-session' &&
      metadata.writebackCapable === true &&
      metadata.liveness === 'live';
  const isApproved = canonicalState ? canonicalState.isApproved : metadata?.status === 'approved';
  const hasPendingWriteback = canonicalState
    ? canonicalState.pendingWritebackExpiresAt !== null &&
      canonicalState.pendingWritebackExpiresAt > Date.now()
    : latest?.status === 'pending' && latest.expiresAt > Date.now();
  const hasQueuedAction = queuedAction !== null;
  const canQueueAnyWriteback =
    isLive && daemonAvailable && canQueueWriteback && !isApproved && !hasPendingWriteback;
  const canRequestChanges = canQueueAnyWriteback;
  const canApprove = canQueueAnyWriteback;
  const requestHasBody = Boolean(feedback.trim() || revisedContent.trim());
  const requestChangesDisabled =
    submittingAction !== null || hasQueuedAction || !canRequestChanges || !requestHasBody;
  const approveDisabled = submittingAction !== null || hasQueuedAction || !canApprove;

  if (!metadata) return null;

  async function approvePlan() {
    if (!canApprove) return;
    setSubmittingAction('approve');
    setError(undefined);
    setQueuedAction(null);
    try {
      await enqueueWriteback({
        planId: plan.id as Id<'plans'>,
        action: 'approve',
        feedback: '',
      });
      setQueuedAction('approve');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to queue approval');
    } finally {
      setSubmittingAction(null);
    }
  }

  async function requestChanges() {
    if (!canRequestChanges || !requestHasBody) return;
    setSubmittingAction('request_changes');
    setError(undefined);
    setQueuedAction(null);
    try {
      await enqueueWriteback({
        planId: plan.id as Id<'plans'>,
        action: 'request_changes',
        feedback: feedback.trim(),
        revisedContent: revisedContent.trim() || undefined,
      });
      setFeedback('');
      setRevisedContent('');
      setQueuedAction('request_changes');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to queue request');
    } finally {
      setSubmittingAction(null);
    }
  }

  return (
    <section className={panelClassName(variant)} aria-label="Manual Plannotator request">
      <div className="plannotator-panel-header">
        <div className="min-w-0">
          <h2 className="plannotator-panel-title">Manual request</h2>
          <p className="plannotator-panel-copy">
            {isLive
              ? daemonAvailable
                ? 'Use when inline notes need broader context.'
                : 'Start the CLI daemon to deliver feedback.'
              : 'Write-back is available only for live sessions.'}
          </p>
        </div>
        {latest && <StatusPill status={latest.status} />}
      </div>

      {isLive && (
        <div className="plannotator-writeback-form">
          <label className="plannotator-field">
            <span>Request</span>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="What should change?"
              className={`min-h-[92px] ${FIELD}`}
            />
          </label>
          <label className="plannotator-field">
            <span>Revision</span>
            <textarea
              value={revisedContent}
              onChange={(e) => setRevisedContent(e.target.value)}
              placeholder="Paste replacement content, if needed"
              className={`min-h-[72px] ${FIELD}`}
            />
          </label>
          <div className="plannotator-writeback-footer">
            <div className="plannotator-panel-note">
              {!canQueueWriteback && (
                <span>Only the plan owner can approve or queue request-changes feedback.</span>
              )}
              {canQueueWriteback && !daemonAvailable && (
                <span>
                  Sync paused. Run{' '}
                  <code className="rounded bg-hover px-1 py-0.5">agendex start</code> to enable
                  write-back delivery.
                </span>
              )}
              {canQueueWriteback && daemonAvailable && isApproved && 'This plan is approved.'}
              {canQueueWriteback && daemonAvailable && !isApproved && hasPendingWriteback && (
                <span>A Plannotator request is already pending.</span>
              )}
              {canQueueWriteback &&
                daemonAvailable &&
                queuedAction === 'approve' &&
                'Approval queued for daemon delivery.'}
              {canQueueWriteback &&
                daemonAvailable &&
                queuedAction === 'request_changes' &&
                'Request queued for daemon delivery.'}
              {canQueueWriteback && daemonAvailable && error && (
                <span className="text-[var(--danger)]">{error}</span>
              )}
              {canQueueWriteback && daemonAvailable && !queuedAction && !error && latest?.error
                ? latest.error
                : null}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={approvePlan}
                disabled={approveDisabled}
                className={`${PRIMARY_BUTTON} ${approveDisabled ? 'cursor-default' : 'cursor-pointer'}`}
              >
                {submittingAction === 'approve'
                  ? 'Approving…'
                  : !canQueueWriteback
                    ? 'Owner only'
                    : daemonAvailable
                      ? 'Approve plan'
                      : 'Daemon required'}
              </button>
              <button
                type="button"
                onClick={requestChanges}
                disabled={requestChangesDisabled}
                className={GHOST_BUTTON}
              >
                {submittingAction === 'request_changes'
                  ? 'Queueing…'
                  : !canQueueWriteback
                    ? 'Owner only'
                    : daemonAvailable
                      ? 'Queue request'
                      : 'Daemon required'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
