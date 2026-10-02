import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type Plan } from '../lib/api.ts';
import { downloadPlan } from '../lib/plan-download.ts';
import {
  buildHandoffCommand,
  copyHandoffCommand,
  createHandoffContext,
  crossAgentCandidateSignature,
  hydrateCrossAgentCandidates,
  loadCrossAgentLinkReferences,
  sameLinkReferences,
  suggestCrossAgentPlans,
  type CrossAgentOptions,
  type CrossAgentSuggestion,
  type HandoffCli,
} from '../lib/cross-agent-plans.ts';

export type { CrossAgentOptions };
export function CrossAgentSection({
  plan,
  allPlans,
  options,
  onCompare,
}: {
  plan: Plan;
  allPlans: readonly Plan[];
  options?: CrossAgentOptions;
  onCompare?: (plan: Plan) => void;
}) {
  const loadContent = options?.loadContent;
  const loadLinkReferences = options?.loadLinkReferences;
  const watchLinkReferences = options?.watchLinkReferences;
  const plansComplete = options?.plansComplete ?? true;
  const [suggestions, setSuggestions] = useState<CrossAgentSuggestion[] | null>(null);
  /** Link references the current suggestions were computed from. */
  const [linkSnapshot, setLinkSnapshot] = useState<ReadonlyMap<string, readonly string[]> | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [clis, setClis] = useState<{ id: HandoffCli; label: string }[]>([]);
  const [target, setTarget] = useState<HandoffCli>('codex');
  const [contextPath, setContextPath] = useState('');
  const [command, setCommand] = useState('');
  const [error, setError] = useState('');
  const request = useRef(0);
  const candidateSignature = useMemo(
    () => crossAgentCandidateSignature(plan, allPlans),
    [plan, allPlans],
  );
  const detectRequest = useRef(0);
  const planEpoch = useRef(0);
  const invalidateRequests = useCallback(() => {
    request.current++;
    planEpoch.current++;
  }, []);
  useEffect(() => {
    invalidateRequests();
    setSuggestions(null);
    setLinkSnapshot(null);
    setLoading(false);
    setNotice('');
    setCommand('');
    setError('');
    setContextPath('');
    setClis([]);
    return invalidateRequests;
  }, [plan.id, plan.updatedAt, invalidateRequests]);
  // Candidate plans were added, edited or removed: earlier suggestions may be stale.
  useEffect(() => {
    request.current++;
    setSuggestions(null);
    setLinkSnapshot(null);
    setLoading(false);
    setNotice('');
  }, [candidateSignature, loadContent, loadLinkReferences]);
  // Linked work changed for a plan the suggestions relied on: drop them rather than show stale evidence.
  useEffect(() => {
    if (!watchLinkReferences || !linkSnapshot) return;
    const unsubscribes = [...linkSnapshot].map(([planId, references]) =>
      watchLinkReferences(planId, (next) => {
        if (sameLinkReferences(references, next)) return;
        request.current++;
        setSuggestions(null);
        setLinkSnapshot(null);
        setLoading(false);
        setNotice('Linked pull requests or commits changed. Search again to refresh suggestions.');
      }),
    );
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [linkSnapshot, watchLinkReferences]);
  async function findRelated() {
    const version = ++request.current;
    setLoading(true);
    setLinkSnapshot(null);
    setNotice('');
    const result = await hydrateCrossAgentCandidates(
      plan,
      allPlans,
      loadContent,
      () => version === request.current,
    );
    if (!result) return;
    const { plans: hydrated, unavailable } = result;
    let links: Map<string, readonly string[]> | undefined;
    if (loadLinkReferences && hydrated.length) {
      const loaded = await loadCrossAgentLinkReferences(
        [plan, ...hydrated],
        loadLinkReferences,
        () => version === request.current,
      );
      if (!loaded) return;
      links = loaded;
    }
    setSuggestions(suggestCrossAgentPlans(plan, hydrated, links));
    setLinkSnapshot(links ?? null);
    setLoading(false);
    setNotice(
      `Checked ${hydrated.length} of up to 20 recent plans from other agents in this workspace.${unavailable ? ` Content unavailable for ${unavailable} plans.` : ''}`,
    );
  }
  async function detectTargets() {
    const version = planEpoch.current;
    const detection = ++detectRequest.current;
    setCommand('');
    setClis([]);
    try {
      const result = await api.getHandoffClis();
      if (version !== planEpoch.current || detection !== detectRequest.current) return;
      setCommand('');
      setClis(result.apps);
      if (result.apps[0]) setTarget(result.apps[0].id);
      setError(
        result.apps.length
          ? ''
          : 'No supported CLI was detected on the connected local machine. Export context for manual handoff.',
      );
    } catch {
      if (version !== planEpoch.current || detection !== detectRequest.current) return;
      setError(
        'Connect the local Agendex API to detect installed CLIs. Context export is still available.',
      );
    }
  }
  function exportContext() {
    try {
      downloadPlan(
        { ...plan, title: `${plan.title} handoff`, content: createHandoffContext(plan) },
        'md',
      );
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to export context.');
    }
  }
  function prepareCommand() {
    try {
      if (!clis.some((cli) => cli.id === target)) throw new Error('Detect an installed CLI first.');
      setCommand(buildHandoffCommand(plan, target, contextPath));
      setError('');
    } catch (cause) {
      setCommand('');
      setError(cause instanceof Error ? cause.message : 'Unable to prepare command.');
    }
  }
  return (
    <details className="cross-agent-section">
      <summary>Compare across agents and hand off</summary>
      <p>
        Suggestions use shared file or work references and content overlap. They do not establish
        session lineage.
      </p>
      {!plan.workspace?.trim() ? (
        <p>A workspace is required to find related plans safely.</p>
      ) : (
        <>
          <button
            type="button"
            disabled={loading || !plansComplete || !plan.content?.trim()}
            onClick={() => void findRelated()}
          >
            {loading
              ? 'Finding related plans…'
              : plansComplete
                ? 'Find related plans from other agents'
                : 'Loading plans…'}
          </button>
          {notice && <p role="status">{notice}</p>}
          {suggestions?.length === 0 && <p>No strong matches found in the checked plans.</p>}
          <ul>
            {suggestions?.map((suggestion) => (
              <li key={suggestion.plan.id}>
                <strong>{suggestion.plan.title}</strong> ({suggestion.plan.agent})
                <p>{suggestion.evidence.join(' · ')}</p>
                {onCompare && (
                  <button
                    type="button"
                    onClick={() => onCompare(suggestion.plan)}
                    aria-label={`Compare ${suggestion.plan.title} with current plan`}
                  >
                    Compare plans
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>Hand off to a new session</h3>
      <p>
        Export the context, review it, and save it on the machine where the CLI will run. Commands
        use a POSIX shell and start a new session. Agendex never executes them.
      </p>
      <button type="button" onClick={exportContext} disabled={!plan.content?.trim()}>
        Download handoff Markdown
      </button>{' '}
      <button type="button" onClick={() => void detectTargets()}>
        Detect installed CLIs
      </button>
      {clis.length > 0 && (
        <div>
          <label>
            Target agent{' '}
            <select
              value={target}
              onChange={(event) => {
                setTarget(event.target.value as HandoffCli);
                setCommand('');
              }}
            >
              {clis.map((cli) => (
                <option key={cli.id} value={cli.id}>
                  {cli.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Absolute path to downloaded context{' '}
            <input
              value={contextPath}
              onChange={(event) => {
                setContextPath(event.target.value);
                setCommand('');
              }}
              placeholder="/absolute/path/to/handoff.md"
            />
          </label>
          <button type="button" onClick={prepareCommand}>
            Prepare command
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {command && (
        <>
          <label>
            Reviewable command
            <textarea readOnly value={command} rows={4} />
          </label>
          <button
            type="button"
            onClick={() => {
              void copyHandoffCommand(command, navigator.clipboard).then((copied) => {
                setError(copied ? '' : 'Copy failed. Select and copy the command text.');
              });
            }}
          >
            Copy command
          </button>
        </>
      )}
    </details>
  );
}
