import confetti from 'canvas-confetti';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAgentLabel } from '../lib/agent-colors.ts';
import type { AgentStats } from '../lib/api.ts';
import { AgentIcon } from './AgentIcon.tsx';

declare global {
  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (ms: number) => void;
  }
}

interface EmptyStateViewProps {
  onSearch?: () => void;
  planCount?: number;
  agents?: AgentStats[];
}

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

function ActionPill({
  icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="empty-state-pill empty-state-pill--accent"
    >
      <span className="empty-state-pill-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function StageCard({
  className,
  lines,
  active = false,
}: {
  className: string;
  lines: Array<'long' | 'mid' | 'short'>;
  active?: boolean;
}) {
  return (
    <div className={`${className}${active ? ' empty-state-stage-card--active' : ''}`}>
      <span className="empty-state-stage-chip" />
      <div className="empty-state-stage-lines">
        {lines.map((line) => (
          <span
            key={`${className}-${line}`}
            className={`empty-state-stage-line empty-state-stage-line--${line}`}
          />
        ))}
      </div>
    </div>
  );
}

function useAgentRotation(agentIds: string[]) {
  const [indices, setIndices] = useState<{ current: number; prev: number | null }>({
    current: 0,
    prev: null,
  });
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const count = agentIds.length;
  const agentKey = agentIds.join('\u001f');

  useEffect(() => {
    setIndices({ current: 0, prev: null });
  }, [agentKey]);

  useEffect(() => {
    if (count <= 1) return;
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }

    const id = setInterval(() => {
      setIndices((state) => ({ current: (state.current + 1) % count, prev: state.current }));
    }, 4200);

    return () => clearInterval(id);
  }, [count]);

  useEffect(() => {
    if (indices.prev === null) return;
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setIndices((state) => ({ ...state, prev: null }));
    }, 430);
    return () => clearTimeout(timeoutRef.current);
  }, [indices.prev]);

  const safeIndex = count > 0 ? indices.current % count : 0;
  const safePrev = indices.prev !== null && count > 0 ? indices.prev % count : null;

  return {
    currentAgent: agentIds[safeIndex] ?? null,
    prevAgent: safePrev !== null ? (agentIds[safePrev] ?? null) : null,
  };
}

function FlippingAgentSummary({
  currentAgent,
  currentText,
  prevAgent,
  prevText,
  widthCh,
}: {
  currentAgent: string;
  currentText: string;
  prevAgent: string | null;
  prevText: string | null;
  widthCh: number;
}) {
  return (
    <div
      className="empty-state-agent-note"
      style={{ '--empty-agent-summary-width': `${widthCh}ch` } as React.CSSProperties}
    >
      <span className="empty-state-agent-icon" aria-hidden="true">
        {prevAgent && (
          <span
            key={`agent-icon-out-${prevAgent}`}
            className="empty-state-agent-icon-layer empty-state-agent-icon-layer--out"
          >
            <AgentIcon agent={prevAgent} size={14} />
          </span>
        )}
        <span
          key={`agent-icon-in-${currentAgent}`}
          className={`empty-state-agent-icon-layer${prevAgent ? ' empty-state-agent-icon-layer--in' : ''}`}
        >
          <AgentIcon agent={currentAgent} size={14} />
        </span>
      </span>

      <span className="empty-state-agent-summary" aria-live="polite">
        {prevText && (
          <span
            key={`agent-summary-out-${prevText}`}
            className="empty-state-agent-summary-layer empty-state-agent-summary-layer--out"
          >
            {prevText}
          </span>
        )}
        <span
          key={`agent-summary-in-${currentText}`}
          className={`empty-state-agent-summary-layer${prevText ? ' empty-state-agent-summary-layer--in' : ''}`}
        >
          {currentText}
        </span>
      </span>
    </div>
  );
}

function TriviaGame({ onExit }: { onExit: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const debugStateRef = useRef<Record<string, unknown>>({});
  const timerStateRef = useRef({ answered: false, complete: false });
  const roundCompleteRef = useRef(false);
  const [round, setRound] = useState(() => buildTriviaRound());
  const [questionNumber, setQuestionNumber] = useState(0);
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(TRIVIA_SECONDS_PER_QUESTION);
  const [liveMessage, setLiveMessage] = useState('AI milestone trivia unlocked.');

  const complete = questionNumber >= round.length;
  const currentQuestion = complete
    ? null
    : (TRIVIA_QUESTIONS[round[questionNumber] ?? 0] ?? TRANSFORMER_TRIVIA_QUESTION);
  const answered = selectedChoice !== null || timedOut;
  const selectedCorrect =
    currentQuestion !== null &&
    selectedChoice !== null &&
    selectedChoice === currentQuestion.answerIndex;

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

    setTimedOut(true);
    setStreak(0);
    setLiveMessage(
      `Time expired. Correct answer: ${currentQuestion.choices[currentQuestion.answerIndex]}. ${currentQuestion.explanation}`,
    );
  }, [answered, complete, currentQuestion, secondsLeft]);

  const handleAnswer = useCallback(
    (choiceIndex: number) => {
      if (!currentQuestion || complete || answered) return;

      setSelectedChoice(choiceIndex);

      if (choiceIndex === currentQuestion.answerIndex) {
        const nextStreak = streak + 1;
        setScore((value) => value + 1);
        setStreak(nextStreak);
        setBestStreak((value) => Math.max(value, nextStreak));
        setLiveMessage(`Correct. ${currentQuestion.explanation}`);
        return;
      }

      setStreak(0);
      setLiveMessage(
        `Incorrect. Correct answer: ${currentQuestion.choices[currentQuestion.answerIndex]}. ${currentQuestion.explanation}`,
      );
    },
    [answered, complete, currentQuestion, streak],
  );

  const handleNext = useCallback(() => {
    if (!answered) return;

    if (questionNumber >= round.length - 1) {
      if (roundCompleteRef.current) return;
      roundCompleteRef.current = true;
      setQuestionNumber(round.length);
      setLiveMessage(
        `Round complete. Score ${score} of ${round.length}. Best streak ${bestStreak}.`,
      );
      fireTriviaConfetti('complete');
      return;
    }

    setQuestionNumber((value) => value + 1);
    setSelectedChoice(null);
    setTimedOut(false);
    setSecondsLeft(TRIVIA_SECONDS_PER_QUESTION);
    setLiveMessage(`Question ${questionNumber + 2} of ${round.length}.`);
  }, [answered, bestStreak, questionNumber, round.length, score]);

  const handleRestart = useCallback(() => {
    roundCompleteRef.current = false;
    setRound(buildTriviaRound());
    setQuestionNumber(0);
    setSelectedChoice(null);
    setTimedOut(false);
    setScore(0);
    setStreak(0);
    setBestStreak(0);
    setSecondsLeft(TRIVIA_SECONDS_PER_QUESTION);
    setLiveMessage('New AI milestone round ready.');
    window.setTimeout(() => panelRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
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
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [answered, complete, handleAnswer, handleNext, handleRestart, onExit]);

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
          <div className="empty-state-trivia-kicker">Konami unlocked</div>
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
          x
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
              Replay
            </button>
            <button type="button" className="empty-state-trivia-secondary" onClick={onExit}>
              Exit
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

export function EmptyStateView({
  onSearch,
  planCount = 0,
  agents = EMPTY_AGENTS,
}: EmptyStateViewProps) {
  const [triviaActive, setTriviaActive] = useState(false);
  const unlockTrivia = useCallback(() => {
    setTriviaActive(true);
    fireTriviaConfetti('unlock');
  }, []);
  useKonamiCode(unlockTrivia);

  const activeAgents = useMemo(
    () => agents.filter((agent) => agent.planCount > 0).sort((a, b) => b.planCount - a.planCount),
    [agents],
  );
  const activeAgentIds = useMemo(() => activeAgents.map((agent) => agent.agent), [activeAgents]);
  const { currentAgent, prevAgent } = useAgentRotation(activeAgentIds);
  const currentAgentStats = currentAgent
    ? (activeAgents.find((agent) => agent.agent === currentAgent) ?? null)
    : null;
  const prevAgentStats = prevAgent
    ? (activeAgents.find((agent) => agent.agent === prevAgent) ?? null)
    : null;

  const hasPlans = planCount > 0;
  const heading = hasPlans ? 'Choose a plan' : 'No plans indexed';
  const description = hasPlans
    ? 'Search by title, source, or agent, or pick one from the sidebar.'
    : 'Plans from watched sources will appear here as soon as agents write them.';
  const planNoun = planCount === 1 ? 'plan' : 'plans';
  const status = hasPlans ? `${planCount} ${planNoun} indexed` : 'Plan index ready';

  function agentSummary(agent: string, stats: AgentStats | null) {
    const count = stats?.planCount ?? 0;
    const noun = count === 1 ? 'plan' : 'plans';
    return `${count} ${noun} from ${getAgentLabel(agent)}`;
  }

  const currentSummary =
    currentAgent && currentAgentStats ? agentSummary(currentAgent, currentAgentStats) : null;
  const prevSummary = prevAgent ? agentSummary(prevAgent, prevAgentStats) : null;
  const maxSummaryLength = Math.max(
    18,
    ...activeAgents.map((agent) => agentSummary(agent.agent, agent).length),
  );

  return (
    <div className="h-full empty-state-shell">
      <div className="empty-state-ambient" aria-hidden="true">
        <span className="empty-state-halo empty-state-halo--left" />
        <span className="empty-state-halo empty-state-halo--right" />
      </div>

      <div className="empty-state-content">
        <div className="empty-state-layout">
          <div className="empty-state-copy">
            <div className="empty-state-kicker">
              <span className="empty-state-kicker-dot" />
              <span>{status}</span>
            </div>

            <h2 className="empty-state-title">{heading}</h2>
            <p className="empty-state-description">{description}</p>

            {onSearch && hasPlans && (
              <div className="empty-state-actions">
                <ActionPill icon={<SearchIcon />} label="Search plans" onClick={onSearch} />
              </div>
            )}

            {currentAgent && currentSummary && (
              <FlippingAgentSummary
                currentAgent={currentAgent}
                currentText={currentSummary}
                prevAgent={prevAgent}
                prevText={prevSummary}
                widthCh={maxSummaryLength}
              />
            )}
          </div>

          <div className="empty-state-stage" aria-hidden={triviaActive ? undefined : true}>
            <div
              className={
                triviaActive
                  ? 'empty-state-stage-shell empty-state-stage-shell--trivia'
                  : `empty-state-stage-shell${hasPlans ? ' is-populated' : ''}`
              }
            >
              {triviaActive ? (
                <TriviaGame onExit={() => setTriviaActive(false)} />
              ) : (
                <>
                  <span className="empty-state-stage-beam" />
                  <StageCard
                    className="empty-state-stage-card empty-state-stage-card--back"
                    lines={['long', 'mid']}
                  />
                  <StageCard
                    className="empty-state-stage-card empty-state-stage-card--middle"
                    lines={['long', 'short']}
                    active={hasPlans}
                  />
                  <StageCard
                    className="empty-state-stage-card empty-state-stage-card--front"
                    lines={['long', 'mid', 'short']}
                    active={hasPlans}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
