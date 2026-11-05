import { useCallback, useEffect, useEffectEvent, useReducer, useRef } from 'react';
import { fireTriviaConfetti } from './trivia-confetti.ts';
import './TriviaGame.css';

declare global {
  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (ms: number) => void;
  }
}

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

  // Test hooks for automated play; they expose the correct answer, so dev builds only.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
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
        answer: currentQuestion.choices[currentQuestion.answerIndex] ?? '',
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

export function TriviaGame({ onExit }: { onExit: () => void }) {
  return useTriviaGame({ onExit });
}
