import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAgentLabel } from '../lib/agent-colors.ts';
import { type AgentStats, api, type Plan, type UsageSummary } from '../lib/api.ts';
import { getAppShortcuts, shortcutDisplayKeys, type ShortcutHint } from '../lib/shortcuts.ts';
import { formatTokens, formatUsd } from '../lib/usage-format.ts';
import { AgentIcon } from './AgentIcon.tsx';
import { fireTriviaConfetti } from './easter-eggs/trivia-confetti.ts';
import { type UsageLoader, UsageView } from './UsageView.tsx';

// The Konami-code trivia game (and its CSS) loads only once the code is entered.
const TriviaGame = lazy(() =>
  import('./easter-eggs/TriviaGame.tsx').then((m) => ({ default: m.TriviaGame })),
);

export interface EmptyStateViewProps {
  onSearch?: () => void;
  planCount?: number;
  agents?: AgentStats[];
  plans?: readonly Plan[];
  onSelectPlan?: (plan: Plan) => void;
  shortcuts?: ShortcutHint[];
  planViewMode?: PlanViewMode;
  usageSummary?: UsageSummary | null;
  usageLoader?: UsageLoader;
}

export type PlanViewMode = 'list' | 'card';
const EMPTY_PLANS: Plan[] = [];

const EMPTY_AGENTS: AgentStats[] = [];
const KONAMI_CODE = [
  'ArrowUp',
  'ArrowUp',
  'ArrowDown',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowLeft',
  'ArrowRight',
  'b',
  'a',
];
const LEDGER_MAX_ROWS = 6;

const WATCH_COMMAND = 'agendex add-dir ~/path/to/plans --live';
const COPY_RESET_MS = 2000;

function normalizeKonamiKey(key: string) {
  return key.length === 1 ? key.toLowerCase() : key;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    target.isContentEditable ||
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select'
  );
}

function useKonamiCode(onUnlock: () => void) {
  const progressRef = useRef(0);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.repeat || isEditableTarget(event.target)) return;

      const key = normalizeKonamiKey(event.key);
      const expectedKey = KONAMI_CODE[progressRef.current];

      if (key === expectedKey) {
        progressRef.current += 1;

        if (progressRef.current === KONAMI_CODE.length) {
          progressRef.current = 0;
          onUnlock();
        }

        return;
      }

      progressRef.current = key === KONAMI_CODE[0] ? 1 : 0;
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onUnlock]);
}

function SearchIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function FrameRule({ ticks = false }: { ticks?: boolean }) {
  return (
    <div className="empty-state-rule" aria-hidden="true">
      {ticks && (
        <>
          <span className="empty-state-rule-tick empty-state-rule-tick--start" />
          <span className="empty-state-rule-tick empty-state-rule-tick--end" />
        </>
      )}
    </div>
  );
}

function WatchCommand() {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(resetTimerRef.current), []);

  const handleCopy = useCallback(async () => {
    if (!navigator.clipboard) return;

    try {
      await navigator.clipboard.writeText(WATCH_COMMAND);
    } catch {
      return;
    }

    setCopied(true);
    window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(() => setCopied(false), COPY_RESET_MS);
  }, []);

  return (
    <div className="empty-state-command-group">
      <div className="empty-state-command">
        <code className="empty-state-command-text">
          <span className="empty-state-command-prompt" aria-hidden="true">
            $
          </span>
          {WATCH_COMMAND}
        </code>
        <button
          type="button"
          className="empty-state-command-copy"
          onClick={handleCopy}
          data-copied={copied || undefined}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="empty-state-command-hint">
        Run it once per folder. New plans are indexed the moment they land.
      </p>
    </div>
  );
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function BackIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M15 18l-6-6 6-6"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AgentLedger({
  agents,
  planCount,
  maxCount,
  selectedAgent,
  onSelectAgent,
}: {
  agents: AgentStats[];
  planCount: number;
  maxCount: number;
  selectedAgent: string | null;
  onSelectAgent: (agent: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? agents : agents.slice(0, LEDGER_MAX_ROWS);
  const hiddenCount = agents.length - LEDGER_MAX_ROWS;

  return (
    <section className="empty-state-ledger" aria-label="Plans by agent">
      <div className="empty-state-ledger-head">
        <h3 className="empty-state-ledger-title">Plans by agent</h3>
        <span className="empty-state-ledger-total">{planCount.toLocaleString()} total</span>
      </div>
      <ul className="empty-state-ledger-rows">
        {visible.map((agent) => {
          const share = maxCount > 0 ? agent.planCount / maxCount : 0;
          const selected = selectedAgent === agent.agent;

          return (
            <li key={agent.agent}>
              <button
                type="button"
                className={`empty-state-ledger-row empty-state-ledger-row--button${selected ? ' empty-state-ledger-row--selected' : ''}`}
                onClick={() => onSelectAgent(agent.agent)}
                aria-pressed={selected}
              >
                <span className="empty-state-ledger-icon" aria-hidden="true">
                  <AgentIcon agent={agent.agent} size={14} />
                </span>
                <span className="empty-state-ledger-name">{getAgentLabel(agent.agent)}</span>
                <span className="empty-state-ledger-bar" aria-hidden="true">
                  <span
                    className="empty-state-ledger-bar-fill"
                    style={
                      {
                        '--empty-ledger-share': `${Math.max(share * 100, 6)}%`,
                      } as React.CSSProperties
                    }
                  />
                </span>
                <span className="empty-state-ledger-count">{agent.planCount.toLocaleString()}</span>
              </button>
            </li>
          );
        })}
        {!expanded && hiddenCount > 0 && (
          <li>
            <button
              type="button"
              className="empty-state-ledger-row empty-state-ledger-row--button empty-state-ledger-row--more"
              onClick={() => setExpanded(true)}
            >
              <span className="empty-state-ledger-name">
                {hiddenCount} more {hiddenCount === 1 ? 'agent' : 'agents'}
              </span>
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}

/**
 * Fetch the aggregated agent usage summary once. Fails silently (returns
 * null) so shells without the local usage endpoint simply hide the panel.
 */
function useUsageSummary(
  enabled: boolean,
  initialSummary: UsageSummary | null | undefined,
  loadUsage: UsageLoader,
): { summary: UsageSummary | null; loading: boolean } {
  const [summary, setSummary] = useState<UsageSummary | null>(initialSummary ?? null);
  const [loading, setLoading] = useState(initialSummary === undefined);
  const sourceRef = useRef(loadUsage);

  // Reset during render so a local→cloud switch never paints the prior source.
  if (sourceRef.current !== loadUsage) {
    sourceRef.current = loadUsage;
    setSummary(initialSummary ?? null);
    setLoading(initialSummary === undefined);
  }

  useEffect(() => {
    if (initialSummary !== undefined) {
      setSummary(initialSummary);
      setLoading(false);
      return;
    }
    setSummary(null);
  }, [initialSummary]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    loadUsage()
      .then((result) => {
        if (!cancelled) setSummary(result);
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, loadUsage]);

  return { summary, loading };
}

function UsageLedgerLoading() {
  return (
    <section
      className="empty-state-ledger empty-state-usage empty-state-usage--loading"
      aria-label="Agent usage"
      aria-busy="true"
      role="status"
    >
      <div className="empty-state-ledger-head">
        <h3 className="empty-state-ledger-title">Agent usage</h3>
        <span className="empty-state-ledger-total">Aggregating usage stats…</span>
      </div>
      <div className="empty-state-usage-loading-row" aria-hidden="true">
        <span className="empty-state-usage-loading-icon skeleton-pulse" />
        <span className="empty-state-usage-loading-name skeleton-pulse" />
        <span className="empty-state-usage-loading-bar skeleton-pulse" />
        <span className="empty-state-usage-loading-count skeleton-pulse" />
      </div>
    </section>
  );
}

function UsageLedger({ usage, onOpen }: { usage: UsageSummary; onOpen: () => void }) {
  const maxCost = usage.agents[0]?.costUsd ?? 0;
  const maxTokens = usage.agents[0]?.totalTokens ?? 0;
  // Cost drives the share bars unless nothing could be priced.
  const byCost = maxCost > 0;

  return (
    <section className="empty-state-ledger empty-state-usage" aria-label="Agent usage">
      <div className="empty-state-ledger-head">
        <h3 className="empty-state-ledger-title">Agent usage · past {usage.days} days</h3>
        <span className="empty-state-ledger-total">
          {byCost && `${formatUsd(usage.costUsd)} · `}
          {formatTokens(usage.totalTokens)} tokens
          <button type="button" className="empty-state-usage-open" onClick={onOpen}>
            View usage →
          </button>
        </span>
      </div>
      <ul className="empty-state-ledger-rows">
        {usage.agents.map((agent) => {
          const share = byCost
            ? maxCost > 0
              ? agent.costUsd / maxCost
              : 0
            : maxTokens > 0
              ? agent.totalTokens / maxTokens
              : 0;

          return (
            <li key={agent.agent}>
              <div className="empty-state-ledger-row empty-state-usage-row">
                <span className="empty-state-ledger-icon" aria-hidden="true">
                  <AgentIcon agent={agent.agent} size={14} />
                </span>
                <span className="empty-state-ledger-name">{getAgentLabel(agent.agent)}</span>
                <span className="empty-state-ledger-bar" aria-hidden="true">
                  <span
                    className="empty-state-ledger-bar-fill"
                    style={
                      {
                        '--empty-ledger-share': `${Math.max(share * 100, 6)}%`,
                      } as React.CSSProperties
                    }
                  />
                </span>
                <span className="empty-state-ledger-count">
                  {byCost && agent.costUsd > 0 && (
                    <span className="empty-state-usage-cost">{formatUsd(agent.costUsd)}</span>
                  )}
                  {formatTokens(agent.totalTokens)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="empty-state-usage-note">
        {usage.sessions.toLocaleString()} {usage.sessions === 1 ? 'session' : 'sessions'}
        {byCost && ' · API-equivalent cost estimate'}
        {usage.unpricedRecords > 0 && ` · ${usage.unpricedRecords.toLocaleString()} unpriced`}
      </p>
    </section>
  );
}

function AgentPlansBrowser({
  agent,
  plans,
  viewMode,
  onBack,
  onSelectPlan,
}: {
  agent: string;
  plans: Plan[];
  viewMode: PlanViewMode;
  onBack: () => void;
  onSelectPlan?: (plan: Plan) => void;
}) {
  const label = getAgentLabel(agent);

  return (
    <div className="empty-state-agent-browser">
      <div className="empty-state-agent-browser-head">
        <button type="button" className="empty-state-agent-back" onClick={onBack}>
          <BackIcon />
          All agents
        </button>
        <div className="empty-state-agent-browser-title">
          <span className="empty-state-agent-browser-icon" aria-hidden="true">
            <AgentIcon agent={agent} size={16} />
          </span>
          <div className="empty-state-agent-browser-copy">
            <h2 className="empty-state-agent-browser-name">{label}</h2>
            <p className="empty-state-agent-browser-meta">
              {plans.length.toLocaleString()} {plans.length === 1 ? 'plan' : 'plans'}
            </p>
          </div>
        </div>
      </div>

      {plans.length === 0 ? (
        <p className="empty-state-agent-empty">No plans for this agent yet.</p>
      ) : (
        <div className="empty-state-plan-scroll" role="region" aria-label={`${label} plans`}>
          {viewMode === 'list' ? (
            <ul className="empty-state-plan-list">
              {plans.map((plan) => (
                <li key={plan.id}>
                  <button
                    type="button"
                    className="empty-state-plan-row"
                    onClick={() => onSelectPlan?.(plan)}
                  >
                    <span className="empty-state-plan-row-title">{plan.title}</span>
                    <span className="empty-state-plan-row-meta">{timeAgo(plan.updatedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="empty-state-plan-grid">
              {plans.map((plan) => (
                <li key={plan.id}>
                  <button
                    type="button"
                    className="empty-state-plan-card"
                    onClick={() => onSelectPlan?.(plan)}
                  >
                    <span className="empty-state-plan-card-title">{plan.title}</span>
                    <span className="empty-state-plan-card-meta">
                      Updated {timeAgo(plan.updatedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function EmptyStateView({
  onSearch,
  planCount = 0,
  agents = EMPTY_AGENTS,
  plans = EMPTY_PLANS,
  onSelectPlan,
  shortcuts = getAppShortcuts(),
  planViewMode,
  usageSummary,
  usageLoader = api.getUsage,
}: EmptyStateViewProps) {
  const [triviaActive, setTriviaActive] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [viewingUsage, setViewingUsage] = useState(false);
  const viewMode = planViewMode ?? 'list';

  const unlockTrivia = useCallback(() => {
    setTriviaActive(true);
    fireTriviaConfetti('unlock');
  }, []);
  useKonamiCode(unlockTrivia);

  const activeAgents = useMemo(
    () => agents.filter((agent) => agent.planCount > 0).sort((a, b) => b.planCount - a.planCount),
    [agents],
  );

  const agentPlans = useMemo(() => {
    if (!selectedAgent) return EMPTY_PLANS;
    return plans
      .filter((plan) => plan.agent === selectedAgent)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [plans, selectedAgent]);

  const maxAgentCount = activeAgents[0]?.planCount ?? 0;
  const agentCount = activeAgents.length;
  const hasPlans = planCount > 0;
  const browsingAgent = selectedAgent !== null && !triviaActive && !viewingUsage;
  const browsingUsage = viewingUsage && !triviaActive;
  const browsing = browsingAgent || browsingUsage;
  const showLedger = hasPlans && !triviaActive && agentCount > 0 && !browsing;
  const { summary: usage, loading: usageLoading } = useUsageSummary(
    true,
    usageSummary,
    usageLoader,
  );
  const showUsage =
    usage !== null && usage.records > 0 && usage.agents.length > 0 && !triviaActive && !browsing;
  const showUsageLoading = usageLoading && usage === null && !triviaActive && !browsing;
  const searchShortcut = '/';

  const heading = hasPlans ? 'Choose a plan to review' : 'No plans indexed yet';
  const description = hasPlans
    ? 'Search by title, source, or agent, or pick one from the sidebar.'
    : 'Point Agendex at the folders your agents write plans to, and every plan shows up here as it is written.';
  const statusLabel = hasPlans
    ? `${planCount.toLocaleString()} ${planCount === 1 ? 'plan' : 'plans'} indexed`
    : 'index ready';
  const statusMeta = hasPlans
    ? agentCount > 0
      ? `from ${agentCount} ${agentCount === 1 ? 'agent' : 'agents'}`
      : null
    : 'waiting for the first plan';

  return (
    <div className={`empty-state-shell${browsing ? ' empty-state-shell--browser' : ''}`}>
      <div className={`empty-state-frame${browsing ? ' empty-state-frame--browser' : ''}`}>
        <FrameRule ticks />

        <header className="empty-state-status" role="status">
          <span
            className={`empty-state-beacon${hasPlans ? ' empty-state-beacon--live' : ''}`}
            aria-hidden="true"
          />
          <span className="empty-state-status-label">{statusLabel}</span>
          {statusMeta && (
            <>
              <span className="empty-state-status-sep" aria-hidden="true">
                ·
              </span>
              <span className="empty-state-status-meta">{statusMeta}</span>
            </>
          )}
        </header>

        <FrameRule />

        <div className={`empty-state-main${browsing ? ' empty-state-main--browser' : ''}`}>
          {triviaActive ? (
            <Suspense fallback={null}>
              <div className="empty-state-panel empty-state-panel--trivia">
                <TriviaGame onExit={() => setTriviaActive(false)} />
              </div>
            </Suspense>
          ) : browsingUsage ? (
            <UsageView
              onBack={() => setViewingUsage(false)}
              initialSummary={usage}
              loadUsage={usageLoader}
              key={usageLoader === api.getUsage ? 'local' : 'cloud'}
            />
          ) : browsingAgent && selectedAgent ? (
            <AgentPlansBrowser
              agent={selectedAgent}
              plans={agentPlans}
              viewMode={viewMode}
              onBack={() => setSelectedAgent(null)}
              onSelectPlan={onSelectPlan}
            />
          ) : (
            <>
              <h2 className="empty-state-title">{heading}</h2>
              <p className="empty-state-description">{description}</p>

              {!hasPlans && <WatchCommand />}

              {onSearch && hasPlans && (
                <div className="empty-state-actions">
                  <button type="button" className="empty-state-primary" onClick={onSearch}>
                    <SearchIcon />
                    Search plans
                    <kbd>{searchShortcut}</kbd>
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <FrameRule ticks />

        {showLedger && (
          <AgentLedger
            agents={activeAgents}
            planCount={planCount}
            maxCount={maxAgentCount}
            selectedAgent={selectedAgent}
            onSelectAgent={setSelectedAgent}
          />
        )}

        {showUsage && usage && <UsageLedger usage={usage} onOpen={() => setViewingUsage(true)} />}

        {showUsageLoading && <UsageLedgerLoading />}

        <footer
          className={`empty-state-foot${showLedger || showUsage || showUsageLoading || browsing ? ' empty-state-foot--divided' : ''}`}
        >
          {shortcuts.map((shortcut) => {
            const keys = shortcutDisplayKeys(shortcut);
            return (
              <span key={shortcut.id} className="empty-state-hint">
                {keys.map((key) => (
                  <kbd key={`${shortcut.id}-${key}`}>{key}</kbd>
                ))}
                {shortcut.label}
              </span>
            );
          })}
        </footer>
      </div>
    </div>
  );
}
