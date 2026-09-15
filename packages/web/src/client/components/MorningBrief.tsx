import { type CSSProperties, useMemo } from 'react';
import { getAgentLabel } from '../lib/agent-colors.ts';
import type { Plan } from '../lib/api.ts';
import {
  buildMorningBrief,
  type BriefPlanActivity,
  type BriefWorkspaceRelay,
} from '../lib/morning-brief.ts';
import { AgentIcon } from './AgentIcon.tsx';
import { Skeleton, SkeletonLine } from './Skeleton.tsx';

export function MorningBriefIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 18h16" />
      <path d="M6.2 18a5.8 5.8 0 0 1 11.6 0" />
      <path d="M12 3v3" />
      <path d="m4.9 7.9 2.1 2.1" />
      <path d="m19.1 7.9-2.1 2.1" />
      <path d="M2.5 13h3" />
      <path d="M18.5 13h3" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function timeOfDayTitle(at: number): string {
  const hour = new Date(at).getHours();
  if (hour >= 5 && hour < 12) return 'Morning Brief';
  if (hour >= 12 && hour < 17) return 'Afternoon Brief';
  if (hour >= 17 && hour < 22) return 'Evening Brief';
  return 'Late Shift Brief';
}

function formatClock(at: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(at);
}

function isSameLocalDay(a: number, b: number): boolean {
  const first = new Date(a);
  const second = new Date(b);
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

function formatWindowStart(since: number, until: number, midSentence = false): string {
  if (isSameLocalDay(since, until)) {
    return `${midSentence ? 'today' : 'Today'} at ${formatClock(since)}`;
  }

  const yesterday = new Date(until);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameLocalDay(since, yesterday.getTime())) {
    return `${midSentence ? 'yesterday' : 'Yesterday'} at ${formatClock(since)}`;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(since);
}

function formatRelativeTime(at: number, relativeTo: number): string {
  const minutes = Math.max(0, Math.floor((relativeTo - at) / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(at);
}

function workspaceName(workspace: string | undefined, filePath?: string): string {
  const source = workspace?.trim() || filePath?.trim() || 'Local plan';
  const parts = source.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || source;
}

function movementSummary(planCount: number, agentCount: number, workspaceCount: number): string {
  if (planCount === 0) return 'No plan files changed in this window.';
  const plans = `${planCount} plan${planCount === 1 ? '' : 's'} moved`;
  const agents = `${agentCount} agent${agentCount === 1 ? '' : 's'}`;
  if (workspaceCount === 0) return `${plans} with ${agents}.`;
  return `${plans} across ${workspaceCount} workspace${workspaceCount === 1 ? '' : 's'} with ${agents}.`;
}

function BriefLoadingState() {
  return (
    <div className="morning-brief-loading" aria-label="Building your activity brief">
      <div className="morning-brief-loading-heading">
        <Skeleton width="210px" height="30px" />
        <SkeletonLine width="330px" />
      </div>
      <Skeleton width="100%" height="72px" borderRadius="10px" />
      <div className="morning-brief-loading-grid">
        <Skeleton width="100%" height="300px" borderRadius="10px" />
        <Skeleton width="100%" height="300px" borderRadius="10px" />
      </div>
    </div>
  );
}

function ActivityRail({
  activities,
  since,
  until,
  newPlanCount,
  updatedPlanCount,
}: {
  activities: BriefPlanActivity[];
  since: number;
  until: number;
  newPlanCount: number;
  updatedPlanCount: number;
}) {
  const duration = Math.max(1, until - since);
  const accessibleSummary = activities
    .map(
      (activity) =>
        `${activity.plan.title}, ${activity.kind} at ${formatClock(activity.occurredAt)}`,
    )
    .join('; ');

  return (
    <section className="morning-brief-activity" aria-labelledby="brief-activity-title">
      <div className="morning-brief-section-heading">
        <div>
          <h2 id="brief-activity-title">Activity over time</h2>
          <p>
            {activities.length > 0
              ? 'Each mark is a local plan file change.'
              : 'New plan activity will appear here.'}
          </p>
        </div>
        <div className="morning-brief-legend" aria-label="Activity legend">
          <span>
            <i data-kind="created" aria-hidden="true" />
            New: {newPlanCount}
          </span>
          <span>
            <i data-kind="updated" aria-hidden="true" />
            Updated: {updatedPlanCount}
          </span>
        </div>
      </div>

      <div
        className="morning-brief-rail"
        data-empty={activities.length === 0 ? 'true' : undefined}
        role="img"
        aria-label={accessibleSummary || `No plan changes since ${formatWindowStart(since, until)}`}
      >
        <div className="morning-brief-rail-line" aria-hidden="true" />
        {activities.map((activity) => {
          const position = Math.max(
            0.7,
            Math.min(99.3, ((activity.occurredAt - since) / duration) * 100),
          );
          return (
            <span
              key={activity.plan.id}
              className="morning-brief-rail-point"
              data-kind={activity.kind}
              title={`${activity.plan.title}, ${formatClock(activity.occurredAt)}`}
              style={{ '--brief-position': `${position}%` } as CSSProperties}
              aria-hidden="true"
            />
          );
        })}
      </div>
      <div className="morning-brief-rail-boundaries" aria-hidden="true">
        <span>{formatWindowStart(since, until)}</span>
        <span>Now, {formatClock(until)}</span>
      </div>
    </section>
  );
}

function Progress({ activity }: { activity: BriefPlanActivity }) {
  const { checklist } = activity;
  if (checklist.total === 0) {
    return (
      <div className="morning-brief-progress morning-brief-progress--plain">
        <span>Latest update</span>
        <div className="morning-brief-progress-track" aria-hidden="true">
          <i style={{ width: '18%' }} />
        </div>
      </div>
    );
  }

  const percent = Math.round((checklist.completed / checklist.total) * 100);
  return (
    <div className="morning-brief-progress">
      <span>
        {checklist.completed} of {checklist.total} done
      </span>
      <div
        className="morning-brief-progress-track"
        role="progressbar"
        aria-label={`Task progress for ${activity.plan.title}`}
        aria-valuemin={0}
        aria-valuemax={checklist.total}
        aria-valuenow={checklist.completed}
      >
        <i style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function PickupRow({
  activity,
  until,
  onSelectPlan,
}: {
  activity: BriefPlanActivity;
  until: number;
  onSelectPlan: (plan: Plan) => void;
}) {
  const nextStep = activity.checklist.nextStep || 'Review the latest plan update';
  const source = activity.plan.workspace?.trim() || activity.plan.filePath;

  return (
    <li>
      <button
        type="button"
        className="morning-brief-plan-row"
        onClick={() => onSelectPlan(activity.plan)}
        aria-label={`Open ${activity.plan.title}. Next step: ${nextStep}`}
      >
        <span className="morning-brief-plan-identity">
          <span className="morning-brief-agent-mark" aria-hidden="true">
            <AgentIcon agent={activity.plan.agent} size={17} />
          </span>
          <span className="morning-brief-plan-copy">
            <strong>{activity.plan.title}</strong>
            <span title={source}>
              {getAgentLabel(activity.plan.agent)} ·{' '}
              {workspaceName(activity.plan.workspace, activity.plan.filePath)}
            </span>
          </span>
        </span>
        <Progress activity={activity} />
        <span className="morning-brief-next-step">
          <small>Next</small>
          <span>{nextStep}</span>
        </span>
        <span className="morning-brief-row-action">
          <time dateTime={new Date(activity.occurredAt).toISOString()}>
            {formatRelativeTime(activity.occurredAt, until)}
          </time>
          <ArrowIcon />
        </span>
      </button>
    </li>
  );
}

function RelayRow({
  relay,
  until,
  onSelectPlan,
}: {
  relay: BriefWorkspaceRelay;
  until: number;
  onSelectPlan: (plan: Plan) => void;
}) {
  const latestPlan = relay.plans[0];
  if (!latestPlan) return null;
  const agentNames = relay.agents.map(getAgentLabel).join(', ');

  return (
    <li>
      <button
        type="button"
        className="morning-brief-relay-row"
        onClick={() => onSelectPlan(latestPlan)}
        aria-label={`Open latest plan in ${relay.workspace}. Agents: ${agentNames}`}
      >
        <span className="morning-brief-relay-workspace">
          <strong>{workspaceName(relay.workspace)}</strong>
          <span title={relay.workspace}>{relay.workspace}</span>
        </span>
        <span className="morning-brief-relay-agents" aria-label={agentNames}>
          {relay.agents.slice(0, 3).map((agent) => (
            <span key={agent} title={getAgentLabel(agent)}>
              <AgentIcon agent={agent} size={14} />
            </span>
          ))}
          <small>{relay.agents.length} agents</small>
        </span>
        <span className="morning-brief-relay-meta">
          <small>{relay.plans.length} plans</small>
          <time dateTime={new Date(relay.occurredAt).toISOString()}>
            {formatRelativeTime(relay.occurredAt, until)}
          </time>
        </span>
        <ArrowIcon />
      </button>
    </li>
  );
}

function ClosedLoopRow({
  activity,
  until,
  onSelectPlan,
}: {
  activity: BriefPlanActivity;
  until: number;
  onSelectPlan: (plan: Plan) => void;
}) {
  return (
    <li>
      <button
        type="button"
        className="morning-brief-closed-row"
        onClick={() => onSelectPlan(activity.plan)}
        aria-label={`Open completed plan ${activity.plan.title}`}
      >
        <span className="morning-brief-closed-check" aria-hidden="true">
          <CheckIcon />
        </span>
        <span className="morning-brief-closed-agent" title={getAgentLabel(activity.plan.agent)}>
          <AgentIcon agent={activity.plan.agent} size={15} />
        </span>
        <strong>{activity.plan.title}</strong>
        <span>{activity.checklist.completed} tasks checked</span>
        <time dateTime={new Date(activity.occurredAt).toISOString()}>
          {formatRelativeTime(activity.occurredAt, until)}
        </time>
        <ArrowIcon />
      </button>
    </li>
  );
}

export interface MorningBriefProps {
  plans: readonly Plan[];
  since: number;
  until: number;
  loading?: boolean;
  error?: string | null;
  markedRead?: boolean;
  onMarkRead: () => void;
  onSelectPlan: (plan: Plan) => void;
  onRetry?: () => void;
}

export function MorningBrief({
  plans,
  since,
  until,
  loading = false,
  error,
  markedRead = false,
  onMarkRead,
  onSelectPlan,
  onRetry,
}: MorningBriefProps) {
  const brief = useMemo(() => buildMorningBrief(plans, since, until), [plans, since, until]);
  const markReadDisabled = loading || Boolean(error) || markedRead || brief.planCount === 0;

  return (
    <main className="morning-brief" aria-labelledby="morning-brief-title">
      <div className="morning-brief-frame">
        <header className="morning-brief-header">
          <div>
            <div className="morning-brief-context">
              <MorningBriefIcon size={15} />
              <span>Local activity recap</span>
            </div>
            <h1 id="morning-brief-title">{timeOfDayTitle(until)}</h1>
            <p className="morning-brief-summary">
              {movementSummary(brief.planCount, brief.agentCount, brief.workspaceCount)}
            </p>
            <p className="morning-brief-window">Since {formatWindowStart(since, until, true)}</p>
          </div>
          <div className="morning-brief-header-actions">
            <span className="morning-brief-local-note">
              Computed from local timestamps and task lists.
            </span>
            <button
              type="button"
              className="morning-brief-mark-read"
              onClick={onMarkRead}
              disabled={markReadDisabled}
              data-read={markedRead ? 'true' : undefined}
            >
              <CheckIcon />
              {markedRead
                ? 'Brief read'
                : loading
                  ? 'Building brief'
                  : error
                    ? 'Brief unavailable'
                    : brief.planCount === 0
                      ? 'Brief is current'
                      : 'Mark brief read'}
            </button>
          </div>
        </header>

        {loading ? (
          <BriefLoadingState />
        ) : error ? (
          <section className="morning-brief-status" role="alert">
            <div>
              <h2>Agendex could not build this brief</h2>
              <p>The local plan scan returned an error: {error}</p>
            </div>
            {onRetry && (
              <button type="button" onClick={onRetry}>
                Retry plan scan
              </button>
            )}
          </section>
        ) : brief.planCount === 0 ? (
          <section className="morning-brief-zero-state">
            <div className="morning-brief-zero-mark" aria-hidden="true">
              <MorningBriefIcon size={30} />
            </div>
            <div>
              <h2>You are caught up</h2>
              <p>
                No plan files changed since this brief began. The next local update will appear here
                automatically.
              </p>
            </div>
          </section>
        ) : (
          <>
            <ActivityRail
              activities={brief.activity}
              since={brief.since}
              until={brief.until}
              newPlanCount={brief.newPlanCount}
              updatedPlanCount={brief.updatedPlanCount}
            />

            <div className="morning-brief-workboard">
              <section
                className="morning-brief-panel morning-brief-pickups"
                aria-labelledby="brief-pickups-title"
              >
                <div className="morning-brief-panel-heading">
                  <div>
                    <h2 id="brief-pickups-title">Pick up here</h2>
                    <p>Recent plans with an unfinished step come first.</p>
                  </div>
                  <span>{brief.pickups.length}</span>
                </div>
                {brief.pickups.length > 0 ? (
                  <ol className="morning-brief-plan-list">
                    {brief.pickups.map((activity) => (
                      <PickupRow
                        key={activity.plan.id}
                        activity={activity}
                        until={brief.until}
                        onSelectPlan={onSelectPlan}
                      />
                    ))}
                  </ol>
                ) : (
                  <div className="morning-brief-panel-empty">
                    <strong>Every detected task list is complete</strong>
                    <span>Completed plans are collected below.</span>
                  </div>
                )}
              </section>

              <section
                className="morning-brief-panel morning-brief-relays"
                aria-labelledby="brief-relays-title"
              >
                <div className="morning-brief-panel-heading">
                  <div>
                    <h2 id="brief-relays-title">Cross-agent relays</h2>
                    <p>Workspaces touched by more than one agent.</p>
                  </div>
                  <span>{brief.relays.length}</span>
                </div>
                {brief.relays.length > 0 ? (
                  <ol className="morning-brief-relay-list">
                    {brief.relays.map((relay) => (
                      <RelayRow
                        key={relay.workspace}
                        relay={relay}
                        until={brief.until}
                        onSelectPlan={onSelectPlan}
                      />
                    ))}
                  </ol>
                ) : (
                  <div className="morning-brief-panel-empty">
                    <strong>No relays in this window</strong>
                    <span>A relay appears when two agents update plans in the same workspace.</span>
                  </div>
                )}
              </section>
            </div>

            <section className="morning-brief-closed" aria-labelledby="brief-closed-title">
              <div className="morning-brief-panel-heading">
                <div>
                  <h2 id="brief-closed-title">Closed loops</h2>
                  <p>Plans whose detected task lists are fully checked.</p>
                </div>
                <span>{brief.closedLoops.length}</span>
              </div>
              {brief.closedLoops.length > 0 ? (
                <ol className="morning-brief-closed-list">
                  {brief.closedLoops.map((activity) => (
                    <ClosedLoopRow
                      key={activity.plan.id}
                      activity={activity}
                      until={brief.until}
                      onSelectPlan={onSelectPlan}
                    />
                  ))}
                </ol>
              ) : (
                <div className="morning-brief-panel-empty morning-brief-panel-empty--inline">
                  <strong>No closed loops yet</strong>
                  <span>Fully checked task lists will land here.</span>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
