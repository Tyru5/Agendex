import confetti from 'canvas-confetti';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { getAgentLabel } from '../lib/agent-colors.ts';
import { type AgentStats, api, type Plan, type UsageSummary } from '../lib/api.ts';
import { getAppShortcuts, shortcutDisplayKeys, type ShortcutHint } from '../lib/shortcuts.ts';
import { formatTokens, formatUsd } from '../lib/usage-format.ts';
import { AgentIcon } from './AgentIcon.tsx';
import { type UsageLoader, UsageView } from './UsageView.tsx';

declare global {
  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (ms: number) => void;
  }
}

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
const TRIVIA_SECONDS_PER_QUESTION = 10;
const TRIVIA_ROUND_SIZE = 5;
const LEDGER_MAX_ROWS = 6;

type TriviaQuestion = {
  prompt: string;
  choices: [string, string, string, string];
  answerIndex: number;
  explanation: string;
  tag: string;
};

const TRANSFORMER_TRIVIA_QUESTION: TriviaQuestion = {
  prompt: 'Which 2017 paper introduced the Transformer architecture behind many modern LLMs?',
  choices: [
    'Attention Is All You Need',
    'The Bitter Lesson',
    'ImageNet Classification with Deep CNNs',
    'A Neural Conversational Model',
  ],
  answerIndex: 0,
  explanation: 'The Transformer paper introduced self-attention as the core sequence model.',
  tag: 'LLMs',
};

const TRIVIA_QUESTIONS: TriviaQuestion[] = [
  TRANSFORMER_TRIVIA_QUESTION,
  {
    prompt: 'OpenAI was founded in which year?',
    choices: ['2012', '2015', '2018', '2020'],
    answerIndex: 1,
    explanation: 'OpenAI was founded in 2015 as an AI research organization.',
    tag: 'Companies',
  },
  {
    prompt: 'IBM Deep Blue defeated world chess champion Garry Kasparov in which year?',
    choices: ['1989', '1997', '2006', '2011'],
    answerIndex: 1,
    explanation: 'Deep Blue won the rematch against Kasparov in 1997.',
    tag: 'Milestones',
  },
  {
    prompt: 'AlexNet became a landmark deep learning breakthrough at ImageNet in which year?',
    choices: ['2009', '2012', '2016', '2019'],
    answerIndex: 1,
    explanation:
      'AlexNet won ImageNet 2012 by a large margin and accelerated modern deep learning.',
    tag: 'Vision',
  },
  {
    prompt: 'AlphaGo defeated Lee Sedol in a five-game Go match in which year?',
    choices: ['2014', '2016', '2018', '2021'],
    answerIndex: 1,
    explanation: 'DeepMind AlphaGo won its match against Lee Sedol in 2016.',
    tag: 'Game AI',
  },
  {
    prompt: 'Which company introduced BERT in 2018?',
    choices: ['Google', 'Meta', 'OpenAI', 'Anthropic'],
    answerIndex: 0,
    explanation: 'Google researchers introduced BERT for bidirectional language pretraining.',
    tag: 'NLP',
  },
  {
    prompt: 'ChatGPT first launched publicly in which year?',
    choices: ['2019', '2020', '2022', '2024'],
    answerIndex: 2,
    explanation: 'ChatGPT launched publicly in November 2022.',
    tag: 'Products',
  },
  {
    prompt: 'Which company created CUDA, the GPU computing platform widely used for AI workloads?',
    choices: ['NVIDIA', 'Intel', 'AMD', 'Apple'],
    answerIndex: 0,
    explanation: 'NVIDIA created CUDA to let developers program its GPUs for general computing.',
    tag: 'Infrastructure',
  },
  {
    prompt: 'Google acquired DeepMind in which year?',
    choices: ['2010', '2014', '2017', '2021'],
    answerIndex: 1,
    explanation: 'Google acquired DeepMind in 2014.',
    tag: 'Companies',
  },
  {
    prompt: 'GitHub Copilot was built as an AI pair programmer with technology from which company?',
    choices: ['OpenAI', 'Salesforce', 'IBM', 'Mistral AI'],
    answerIndex: 0,
    explanation: 'GitHub Copilot was built in collaboration with OpenAI.',
    tag: 'Developer Tools',
  },
];

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

function buildTriviaRound() {
  const indices = TRIVIA_QUESTIONS.map((_, index) => index);

  for (let index = indices.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const currentIndex = indices[index];
    const swapValue = indices[swapIndex];

    if (currentIndex === undefined || swapValue === undefined) continue;

    indices[index] = swapValue;
    indices[swapIndex] = currentIndex;
  }

  return indices.slice(0, TRIVIA_ROUND_SIZE);
}

function fireTriviaConfetti(mode: 'unlock' | 'complete') {
  if (typeof window === 'undefined') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const colors = ['#c8ff32', '#ff7a2f', '#879891', '#eef4e8'];

  if (mode === 'unlock') {
    confetti({
      particleCount: 24,
      spread: 38,
      startVelocity: 24,
      ticks: 92,
      scalar: 0.64,
      origin: { x: 0.82, y: 0.34 },
      colors,
      disableForReducedMotion: true,
    });
    return;
  }

  confetti({
    particleCount: 44,
    spread: 52,
    startVelocity: 32,
    ticks: 140,
    scalar: 0.78,
    origin: { x: 0.78, y: 0.55 },
    colors,
    disableForReducedMotion: true,
  });
  window.setTimeout(() => {
    confetti({
      particleCount: 20,
      angle: 122,
      spread: 44,
      startVelocity: 26,
      ticks: 120,
      scalar: 0.7,
      origin: { x: 0.86, y: 0.58 },
      colors,
      disableForReducedMotion: true,
    });
  }, 110);
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
): UsageSummary | null {
  const [summary, setSummary] = useState<UsageSummary | null>(initialSummary ?? null);

  useEffect(() => {
    if (initialSummary !== undefined) {
      setSummary(initialSummary);
      return;
    }
    // Parent handed control to the loader (e.g. local mode): drop any prior
    // cloud/local snapshot immediately so mode switches never show stale data.
    setSummary(null);
  }, [initialSummary]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    loadUsage()
      .then((result) => {
        if (!cancelled) setSummary(result);
      })
      .catch(() => {
        // Endpoint unavailable (cloud shell, older server): hide the panel.
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, loadUsage]);

  return summary;
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

type TriviaGameState = {
  round: number[];
  questionNumber: number;
  selectedChoice: number | null;
  timedOut: boolean;
  score: number;
  streak: number;
  bestStreak: number;
  secondsLeft: number;
  liveMessage: string;
};

type TriviaGameAction =
  | { type: 'SET_SECONDS_LEFT'; value: number | ((current: number) => number) }
  | { type: 'TIMEOUT'; message: string }
  | { type: 'ANSWER'; choiceIndex: number; correct: boolean; explanation: string; answer: string }
  | { type: 'NEXT'; message: string }
  | { type: 'COMPLETE'; message: string }
  | { type: 'RESTART' };

function createTriviaGameState(): TriviaGameState {
  return {
    round: buildTriviaRound(),
    questionNumber: 0,
    selectedChoice: null,
    timedOut: false,
    score: 0,
    streak: 0,
    bestStreak: 0,
    secondsLeft: TRIVIA_SECONDS_PER_QUESTION,
    liveMessage: 'AI milestone trivia unlocked.',
  };
}

function triviaReducer(state: TriviaGameState, action: TriviaGameAction): TriviaGameState {
  switch (action.type) {
    case 'SET_SECONDS_LEFT':
      return {
        ...state,
        secondsLeft:
          typeof action.value === 'function' ? action.value(state.secondsLeft) : action.value,
      };
    case 'TIMEOUT':
      return { ...state, timedOut: true, streak: 0, liveMessage: action.message };
    case 'ANSWER': {
      const streak = action.correct ? state.streak + 1 : 0;
      return {
        ...state,
        selectedChoice: action.choiceIndex,
        score: state.score + (action.correct ? 1 : 0),
        streak,
        bestStreak: Math.max(state.bestStreak, streak),
        liveMessage: action.correct
          ? `Correct. ${action.explanation}`
          : `Incorrect. Correct answer: ${action.answer}. ${action.explanation}`,
      };
    }
    case 'NEXT':
      return {
        ...state,
        questionNumber: state.questionNumber + 1,
        selectedChoice: null,
        timedOut: false,
        secondsLeft: TRIVIA_SECONDS_PER_QUESTION,
        liveMessage: action.message,
      };
    case 'COMPLETE':
      return { ...state, questionNumber: state.round.length, liveMessage: action.message };
    case 'RESTART':
      return { ...createTriviaGameState(), liveMessage: 'New AI milestone round ready.' };
  }
}

function useTriviaGame({ onExit }: { onExit: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const debugStateRef = useRef<Record<string, unknown>>({});
  const timerStateRef = useRef({ answered: false, complete: false });
  const roundCompleteRef = useRef(false);
  const [game, dispatch] = useReducer(triviaReducer, undefined, createTriviaGameState);
  const {
    round,
    questionNumber,
    selectedChoice,
    timedOut,
    score,
    streak,
    bestStreak,
    secondsLeft,
    liveMessage,
  } = game;
  const setSecondsLeft = (value: number | ((current: number) => number)) =>
    dispatch({ type: 'SET_SECONDS_LEFT', value });

  const complete = questionNumber >= round.length;
  const currentQuestion = complete
    ? null
    : (TRIVIA_QUESTIONS[round[questionNumber] ?? 0] ?? TRANSFORMER_TRIVIA_QUESTION);
  const answered = selectedChoice !== null || timedOut;
  const selectedCorrect =
    currentQuestion !== null &&
    selectedChoice !== null &&
    selectedChoice === currentQuestion.answerIndex;

  useEffect(() => {
    timerStateRef.current = { answered, complete };
    debugStateRef.current = {
      mode: complete ? 'complete' : answered ? 'answered' : 'question',
      coordinateSystem: 'DOM trivia panel; no canvas coordinates.',
      question: currentQuestion
        ? {
            number: questionNumber + 1,
            total: round.length,
            prompt: currentQuestion.prompt,
            choices: currentQuestion.choices,
            correctChoice: currentQuestion.choices[currentQuestion.answerIndex],
            tag: currentQuestion.tag,
          }
        : null,
      selectedChoice:
        selectedChoice !== null && currentQuestion ? currentQuestion.choices[selectedChoice] : null,
      timedOut,
      secondsLeft,
      score,
      streak,
      bestStreak,
    };
  }, [
    answered,
    bestStreak,
    complete,
    currentQuestion,
    questionNumber,
    round.length,
    score,
    secondsLeft,
    selectedChoice,
    streak,
    timedOut,
  ]);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    const previousRenderGameToText = window.render_game_to_text;
    const previousAdvanceTime = window.advanceTime;

    window.render_game_to_text = () => JSON.stringify(debugStateRef.current);
    window.advanceTime = (ms: number) => {
      if (timerStateRef.current.answered || timerStateRef.current.complete) return;
      const elapsedSeconds = Math.max(1, Math.ceil(ms / 1000));
      setSecondsLeft((value) => Math.max(0, value - elapsedSeconds));
    };

    return () => {
      if (previousRenderGameToText) {
        window.render_game_to_text = previousRenderGameToText;
      } else {
        delete window.render_game_to_text;
      }

      if (previousAdvanceTime) {
        window.advanceTime = previousAdvanceTime;
      } else {
        delete window.advanceTime;
      }
    };
  }, []);

  useEffect(() => {
    if (complete || answered) return;

    const timer = setInterval(() => {
      setSecondsLeft((value) => Math.max(0, value - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [answered, complete, questionNumber]);

  useEffect(() => {
    if (!currentQuestion || complete || answered || secondsLeft > 0) return;

    dispatch({
      type: 'TIMEOUT',
      message: `Time expired. Correct answer: ${currentQuestion.choices[currentQuestion.answerIndex]}. ${currentQuestion.explanation}`,
    });
  }, [answered, complete, currentQuestion, secondsLeft]);

  const handleAnswer = useCallback(
    (choiceIndex: number) => {
      if (!currentQuestion || complete || answered) return;

      dispatch({
        type: 'ANSWER',
        choiceIndex,
        correct: choiceIndex === currentQuestion.answerIndex,
        explanation: currentQuestion.explanation,
        answer: currentQuestion.choices[currentQuestion.answerIndex],
      });
    },
    [answered, complete, currentQuestion],
  );

  const handleNext = useCallback(() => {
    if (!answered) return;

    if (questionNumber >= round.length - 1) {
      if (roundCompleteRef.current) return;
      roundCompleteRef.current = true;
      dispatch({
        type: 'COMPLETE',
        message: `Round complete. Score ${score} of ${round.length}. Best streak ${bestStreak}.`,
      });
      fireTriviaConfetti('complete');
      return;
    }

    dispatch({ type: 'NEXT', message: `Question ${questionNumber + 2} of ${round.length}.` });
  }, [answered, bestStreak, questionNumber, round.length, score]);

  const handleRestart = useCallback(() => {
    roundCompleteRef.current = false;
    dispatch({ type: 'RESTART' });
    window.setTimeout(() => panelRef.current?.focus(), 0);
  }, []);

  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onExit();
      return;
    }

    if (complete) {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleRestart();
      }
      return;
    }

    if (/^[1-4]$/.test(event.key) && !answered) {
      event.preventDefault();
      handleAnswer(Number(event.key) - 1);
      return;
    }

    if (event.key === 'Enter' && answered) {
      event.preventDefault();
      handleNext();
    }
  });

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <section
      ref={panelRef}
      className="empty-state-trivia"
      aria-label="AI milestone trivia"
      tabIndex={-1}
    >
      <div className="empty-state-trivia-live" aria-live="polite">
        {liveMessage}
      </div>

      <div className="empty-state-trivia-header">
        <div>
          <p className="empty-state-trivia-label">Konami unlocked</p>
          <h3 className="empty-state-trivia-title">
            {complete ? 'Run complete' : 'AI milestone trivia'}
          </h3>
        </div>
        <button
          type="button"
          className="empty-state-trivia-close"
          onClick={onExit}
          aria-label="Exit trivia"
        >
          ×
        </button>
      </div>

      {complete ? (
        <div className="empty-state-trivia-complete">
          <div className="empty-state-trivia-score">
            <span className="empty-state-trivia-score-value">{score}</span>
            <span className="empty-state-trivia-score-label">of {round.length}</span>
          </div>
          <p className="empty-state-trivia-complete-copy">
            Best streak: {bestStreak}. Replay for a new mix of AI and tech milestones.
          </p>
          <div className="empty-state-trivia-actions">
            <button type="button" className="empty-state-trivia-primary" onClick={handleRestart}>
              Replay round
            </button>
            <button type="button" className="empty-state-trivia-secondary" onClick={onExit}>
              Back to index
            </button>
          </div>
        </div>
      ) : (
        currentQuestion && (
          <>
            <div className="empty-state-trivia-meta">
              <span>
                Q{questionNumber + 1}/{round.length}
              </span>
              <span>{currentQuestion.tag}</span>
              <span>{secondsLeft}s</span>
            </div>

            <div className="empty-state-trivia-timer" aria-hidden="true">
              <span
                key={`trivia-timer-${questionNumber}`}
                className="empty-state-trivia-timer-fill"
                style={
                  {
                    '--empty-trivia-timer-duration': `${TRIVIA_SECONDS_PER_QUESTION}s`,
                    '--empty-trivia-timer-state': answered ? 'paused' : 'running',
                  } as React.CSSProperties
                }
              />
            </div>

            <p className="empty-state-trivia-question">{currentQuestion.prompt}</p>

            <div className="empty-state-trivia-choices">
              {currentQuestion.choices.map((choice, index) => {
                const isCorrectChoice = index === currentQuestion.answerIndex;
                const isSelected = selectedChoice === index;
                const stateClass =
                  answered && isCorrectChoice
                    ? ' empty-state-trivia-choice--correct'
                    : answered && isSelected
                      ? ' empty-state-trivia-choice--incorrect'
                      : '';

                return (
                  <button
                    key={`${questionNumber}-${choice}`}
                    type="button"
                    className={`empty-state-trivia-choice${stateClass}`}
                    onClick={() => handleAnswer(index)}
                    disabled={answered}
                    aria-pressed={isSelected}
                    style={{ '--empty-trivia-choice-index': index } as React.CSSProperties}
                  >
                    <span className="empty-state-trivia-choice-key">{index + 1}</span>
                    <span>{choice}</span>
                  </button>
                );
              })}
            </div>

            <div
              className={`empty-state-trivia-feedback${
                answered
                  ? selectedCorrect
                    ? ' empty-state-trivia-feedback--correct'
                    : ' empty-state-trivia-feedback--incorrect'
                  : ''
              }`}
            >
              {answered ? (
                <>
                  <strong>
                    {selectedCorrect ? 'Correct' : timedOut ? 'Time expired' : 'Incorrect'}
                  </strong>
                  <span>{currentQuestion.explanation}</span>
                </>
              ) : (
                <span>Press 1-4 or choose an answer.</span>
              )}
            </div>

            <div className="empty-state-trivia-footer">
              <span>Score {score}</span>
              <span>Streak {streak}</span>
              <button
                type="button"
                className="empty-state-trivia-next"
                onClick={handleNext}
                disabled={!answered}
              >
                {questionNumber >= round.length - 1 ? 'Finish' : 'Next'}
              </button>
            </div>
          </>
        )
      )}
    </section>
  );
}

function TriviaGame({ onExit }: { onExit: () => void }) {
  return useTriviaGame({ onExit });
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
  const usage = useUsageSummary(true, usageSummary, usageLoader);
  const showUsage =
    usage !== null && usage.records > 0 && usage.agents.length > 0 && !triviaActive && !browsing;
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
    <div className={`h-full empty-state-shell${browsing ? ' empty-state-shell--browser' : ''}`}>
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
            <div className="empty-state-panel empty-state-panel--trivia">
              <TriviaGame onExit={() => setTriviaActive(false)} />
            </div>
          ) : browsingUsage ? (
            <UsageView
              onBack={() => setViewingUsage(false)}
              initialSummary={usage}
              loadUsage={usageLoader}
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

        <footer
          className={`empty-state-foot${showLedger || showUsage || browsing ? ' empty-state-foot--divided' : ''}`}
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
