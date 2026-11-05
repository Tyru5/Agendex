import type createConfetti from 'canvas-confetti';

export function fireTriviaConfetti(mode: 'unlock' | 'complete') {
  if (typeof window === 'undefined') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // Loaded on first use: confetti only fires mid-trivia, so it stays out of
  // the dashboard's startup bundle.
  import('canvas-confetti')
    .then(({ default: confetti }) => burstTriviaConfetti(confetti, mode))
    .catch(() => undefined);
}

function burstTriviaConfetti(confetti: typeof createConfetti, mode: 'unlock' | 'complete') {
  const colors = ['#5532c7', '#8a7dfa', '#c9c2ff', '#fbfbff'];

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
