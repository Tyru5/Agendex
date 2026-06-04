import type { PlannotatorMetadata } from '@agendex/shared';
import type { Plan } from '@agendex/web';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useMutation, useQuery } from 'convex/react';
import { useMemo, useState } from 'react';
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
 */
function resolveOpenLiveness(
  plan: Plan,
  metadata: PlannotatorMetadata,
  devices: DaemonDeviceInfo[],
): OpenLiveness {
  const hostname = getSyncHostname(plan);

  // (1) Authoritative: the daemon told us the session ended.
  if (metadata.liveness === 'ended' || metadata.writebackCapable === false) {
    return { state: 'offline', reason: 'session-ended', hostname };
  }

  // (2) Fallback: correlate with the syncing daemon device's liveness.
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

export function CloudPlannotatorBadge({ plan }: { plan: Plan }) {
  const metadata = getPlannotatorMetadata(plan);
  const { devices } = useDaemonStatus();
  if (!metadata) return null;

  const isLiveKind = metadata.kind === 'live-session';
  const liveness = resolveOpenLiveness(plan, metadata, devices);
  const sessionEnded = isLiveKind && liveness.state === 'offline';

  const label = isLiveKind
    ? sessionEnded
      ? 'Plannotator session ended'
      : 'Plannotator live'
    : metadata.kind === 'project-plan'
      ? 'Plannotator project plan'
      : 'Plannotator snapshot';
  // An ended live session is no longer "pending" — reflect that in the dot color.
  const status = sessionEnded
    ? 'unknown'
    : (metadata.status ?? (isLiveKind ? 'pending' : 'unknown'));

  const canOpen = liveness.state === 'open' && isSafeLoopbackUrl(metadata.url);
  // Only show open affordances at all when there is a loopback URL to open.
  const hasLoopbackUrl = isSafeLoopbackUrl(metadata.url);

  const offlineHint =
    liveness.state === 'offline'
      ? liveness.reason === 'session-ended'
        ? `Server offline${liveness.hostname ? ` — reopen the session on '${liveness.hostname}'` : ' — reopen the Plannotator session'}`
        : `Machine offline${liveness.hostname ? ` — start the session on '${liveness.hostname}'` : ' — start the originating machine'}`
      : undefined;

  return (
    <div className="plan-plannotator-badge">
      <span
        className="inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-semibold"
        style={{ borderColor: statusBorderColor(status), color: statusColor(status) }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
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
            className="text-[11px] text-secondary underline decoration-dotted underline-offset-4"
          >
            Open in Plannotator
          </a>
        ) : (
          <span
            className="inline-flex items-center gap-1 text-[11px] text-tertiary"
            title={offlineHint}
          >
            <span className="text-tertiary line-through decoration-dotted">
              Open in Plannotator
            </span>
            {offlineHint && <span className="text-tertiary">· {offlineHint}</span>}
          </span>
        ))}
    </div>
  );
}

export function CloudPlannotatorWritebackPanel({
  plan,
  canQueueWriteback = true,
  daemonAvailable = true,
}: {
  plan: Plan;
  canQueueWriteback?: boolean;
  daemonAvailable?: boolean;
}) {
  const metadata = getPlannotatorMetadata(plan);
  const isLive = metadata?.kind === 'live-session' && metadata.writebackCapable === true;
  const canRequestChanges = isLive && daemonAvailable && canQueueWriteback;
  const enqueueWriteback = useMutation(api.plannotator.enqueueWriteback);
  const writebacks = useQuery(
    api.plannotator.listWritebacksForPlan,
    metadata ? { planId: plan.id as Id<'plans'> } : 'skip',
  );
  const [feedback, setFeedback] = useState('');
  const [revisedContent, setRevisedContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [queued, setQueued] = useState(false);

  const latest = useMemo(() => writebacks?.[0], [writebacks]);

  if (!metadata) return null;

  async function requestChanges() {
    if (!canRequestChanges || (!feedback.trim() && !revisedContent.trim())) return;
    setSubmitting(true);
    setError(undefined);
    setQueued(false);
    try {
      await enqueueWriteback({
        planId: plan.id as Id<'plans'>,
        feedback: feedback.trim(),
        revisedContent: revisedContent.trim() || undefined,
      });
      setFeedback('');
      setRevisedContent('');
      setQueued(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to queue request');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mt-8 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-semibold text-text">Advanced Plannotator write-back</h2>
          <p className="mt-1 text-[12px] text-tertiary">
            {isLive
              ? daemonAvailable
                ? 'Use this manual fallback when inline annotations are not specific enough for the agent.'
                : 'Start the Agendex CLI daemon to deliver request-changes feedback back through Plannotator.'
              : 'This is a saved Plannotator plan. Write-back is only available for live sessions.'}
          </p>
        </div>
        {latest && (
          <span
            className="rounded-full border px-2 py-1 text-[11px] font-semibold"
            style={{
              borderColor: statusBorderColor(latest.status),
              color: statusColor(latest.status),
            }}
          >
            {latest.status}
          </span>
        )}
      </div>

      {isLive && (
        <div className="mt-4 space-y-3">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Describe the changes the agent should make before resubmitting the plan..."
            className="min-h-[92px] w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-[13px] leading-5 text-text outline-none"
          />
          <textarea
            value={revisedContent}
            onChange={(e) => setRevisedContent(e.target.value)}
            placeholder="Optional: paste revised plan content or a specific replacement section..."
            className="min-h-[72px] w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-[13px] leading-5 text-text outline-none"
          />
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] text-tertiary">
              {!canQueueWriteback && (
                <span>Only the plan owner can queue request-changes feedback.</span>
              )}
              {canQueueWriteback && !daemonAvailable && (
                <span>
                  Sync paused. Run{' '}
                  <code className="rounded bg-hover px-1 py-0.5">agendex start</code> to enable
                  write-back delivery.
                </span>
              )}
              {canQueueWriteback && daemonAvailable && queued && 'Queued for daemon delivery.'}
              {canQueueWriteback && daemonAvailable && error && (
                <span className="text-[var(--danger)]">{error}</span>
              )}
              {canQueueWriteback && daemonAvailable && !queued && !error && latest?.error
                ? latest.error
                : null}
            </div>
            <button
              type="button"
              onClick={requestChanges}
              disabled={
                submitting || !canRequestChanges || (!feedback.trim() && !revisedContent.trim())
              }
              className="rounded-lg border-0 bg-text px-3 py-1.5 text-[12px] font-semibold text-bg disabled:opacity-50"
            >
              {submitting
                ? 'Queueing…'
                : !canQueueWriteback
                  ? 'Owner only'
                  : daemonAvailable
                    ? 'Queue manual request'
                    : 'Daemon required'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
