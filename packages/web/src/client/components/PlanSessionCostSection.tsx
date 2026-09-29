import type { PlanSessionCost, SessionCostUnavailableReason } from '@agendex/shared/session-cost';

const REASONS: Record<SessionCostUnavailableReason, string> = {
  'unsupported-agent':
    'Usage transcripts are supported for Claude Code, Codex CLI, and Grok. This agent does not provide supported usage records.',
  'missing-session':
    'This plan has no recorded session ID. A workspace or creation time cannot identify a session.',
  'ambiguous-session': 'This plan has conflicting session IDs. No usage was attributed.',
  'unverified-session':
    'The session association is not verified. For Claude Code, add an explicit sessionId in the plan frontmatter and reindex the plan.',
  'usage-unavailable':
    'No usage snapshot or readable transcript source is available for this session.',
  'incomplete-snapshot':
    'Synced usage events are incomplete. Aggregate usage cannot be safely assigned to this session.',
  'no-records': 'No matching usage records were observed in the last 90 days.',
};
const money = (amount: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: amount > 0 && amount < 0.01 ? 4 : 2,
  }).format(amount);

export function PlanSessionCostSection({
  sessionCost,
  loading = false,
}: {
  sessionCost: PlanSessionCost | null | undefined;
  loading?: boolean;
}) {
  if (sessionCost === undefined && !loading) return null;
  const available = sessionCost?.status === 'available';
  const label = loading
    ? 'Checking…'
    : !available
      ? 'Unavailable'
      : sessionCost.costUsd === null
        ? 'Unknown price'
        : `${sessionCost.pricing === 'partial' ? 'At least' : 'Estimated'} ${money(sessionCost.costUsd)}`;
  return (
    <details className="plan-session-cost" aria-label="Session cost">
      <summary>
        <strong>Session cost</strong>
        <span>{label}</span>
      </summary>
      <div className="plan-session-cost-detail" aria-busy={loading}>
        {loading ? (
          <p>Checking session usage…</p>
        ) : !available ? (
          <p>
            {sessionCost?.reason
              ? REASONS[sessionCost.reason]
              : 'Session usage is unavailable. Cloud session cost is private to the plan owner; local usage requires a connection to Agendex.'}
          </p>
        ) : (
          <>
            <p>
              Observed usage for the whole session in the last {sessionCost.windowDays} days. This
              is not individual plan spend.{' '}
              {sessionCost.sharedPlanCount !== null && sessionCost.sharedPlanCount > 1
                ? `${sessionCost.sharedPlanCount} indexed plans share this session; do not add their session costs together.`
                : 'Other plans can share the same session; do not add their session costs together.'}
            </p>
            <p>
              USD API-equivalent estimate, using provider-reported cost when available. This is not
              a subscription charge or invoice.
            </p>
            <p>
              {sessionCost.totalTokens?.toLocaleString()} tokens ·{' '}
              {sessionCost.records.toLocaleString()} usage records
            </p>
            {sessionCost.unpricedRecords > 0 && (
              <p>
                {sessionCost.unpricedRecords.toLocaleString()} records have unknown pricing.{' '}
                {sessionCost.costUsd === null
                  ? 'No dollar estimate is available.'
                  : 'The displayed amount excludes those records.'}
              </p>
            )}
            <dl>
              <dt>Session</dt>
              <dd>
                <code>{sessionCost.sessionId}</code>
              </dd>
              {sessionCost.models.map((model) => (
                <div key={model.model}>
                  <dt>{model.model}</dt>
                  <dd>
                    {model.totalTokens.toLocaleString()} tokens ·{' '}
                    {model.costUsd === null ? 'Unknown price' : money(model.costUsd)}
                    {model.unpricedRecords > 0 && model.costUsd !== null
                      ? ' + unpriced records'
                      : ''}
                  </dd>
                </div>
              ))}
            </dl>
            {sessionCost.generatedAt && (
              <p>
                Usage scanned{' '}
                <time dateTime={sessionCost.generatedAt}>
                  {new Date(sessionCost.generatedAt).toLocaleString()}
                </time>
                .
              </p>
            )}
          </>
        )}
      </div>
    </details>
  );
}
