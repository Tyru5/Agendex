import { useEffect, useMemo, useRef, useState } from 'react';
import dinoShadow from './dino-shadow.png';
import dinoVitaFrame from './dino-vita-frame.png';
import dinoVitaIdleStrip from './dino-vita-idle-strip.png';
import dinoVitaWalkStrip from './dino-vita-walk-strip.png';

export interface LandingMascotProps {
  greetings?: string[];
  onActivate: () => void;
  triggerElementId?: string;
}

type Direction = 'left' | 'right';

const INTRO_GREETING = "Hi, I'm Ti 👋";
const DEFAULT_GREETINGS = [
  'why am I here?',
  'what is a shader anyway?',
  'do pixels dream?',
  'I think therefore I render',
  'is this the real life?',
  '404: meaning not found',
  '*existential crisis*',
  'we live in a simulation',
  "what's outside the viewport?",
  'am I just vertices?',
  'the void calls...',
  'I walk, but where?',
  'runtime was a mistake',
  'consciousness.exe',
  "help I'm trapped in code",
];
const DINO_RENDER_SIZE = 84;
const DINO_FRAME_COUNT = 4;
const WALKER_WIDTH = 112;
const WALK_MARGIN = 20;
const WALK_MAX_DURATION_MS = 8400;
const WALK_MIN_DURATION_MS = 4600;

function getWalkBounds() {
  if (typeof window === 'undefined') {
    return { min: WALK_MARGIN, max: WALK_MARGIN };
  }

  const max = Math.max(WALK_MARGIN, window.innerWidth - WALKER_WIDTH - WALK_MARGIN);
  return { min: WALK_MARGIN, max };
}

function clampPosition(value: number) {
  const bounds = getWalkBounds();
  return Math.min(Math.max(value, bounds.min), bounds.max);
}

export function LandingMascot({ greetings, onActivate, triggerElementId }: LandingMascotProps) {
  const messagePool = useMemo(
    () => (greetings && greetings.length > 0 ? greetings : DEFAULT_GREETINGS),
    [greetings],
  );
  const [greeting, setGreeting] = useState(INTRO_GREETING);
  const phraseIndexRef = useRef(0);
  const [positionX, setPositionX] = useState(() =>
    typeof window === 'undefined' ? WALK_MARGIN : getWalkBounds().min,
  );
  const [direction, setDirection] = useState<Direction>('right');
  const [moving, setMoving] = useState(false);
  const [walkDurationMs, setWalkDurationMs] = useState(WALK_MIN_DURATION_MS);
  const [hovered, setHovered] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [hoverCapable, setHoverCapable] = useState(false);
  const [isNearBottom, setIsNearBottom] = useState(false);
  const positionRef = useRef(positionX);
  const directionRef = useRef<Direction>('right');
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const walkerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    positionRef.current = positionX;
  }, [positionX]);

  useEffect(() => {
    directionRef.current = direction;
  }, [direction]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const motionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
    const hoverMedia = window.matchMedia('(hover: hover) and (pointer: fine)');

    const syncPreferences = () => {
      setReducedMotion(motionMedia.matches);
      setHoverCapable(hoverMedia.matches);
      setPositionX((current) => clampPosition(current));
    };

    syncPreferences();
    motionMedia.addEventListener('change', syncPreferences);
    hoverMedia.addEventListener('change', syncPreferences);

    return () => {
      motionMedia.removeEventListener('change', syncPreferences);
      hoverMedia.removeEventListener('change', syncPreferences);
    };
  }, []);

  const nextGreeting = () => {
    const idx = phraseIndexRef.current;
    setGreeting(messagePool[idx % messagePool.length]!);
    phraseIndexRef.current = idx + 1;
  };

  useEffect(() => {
    phraseIndexRef.current = 0;
    setGreeting(INTRO_GREETING);
  }, [messagePool]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const syncPosition = () => setPositionX((current) => clampPosition(current));
    syncPosition();
    window.addEventListener('resize', syncPosition);

    return () => window.removeEventListener('resize', syncPosition);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !triggerElementId) return;

    let observer: IntersectionObserver | null = null;
    let rafHandle: number | undefined;

    const setup = () => {
      const el = document.getElementById(triggerElementId);
      if (!el) {
        rafHandle = requestAnimationFrame(setup);
        return;
      }
      observer = new IntersectionObserver(
        ([entry]) => setIsNearBottom(entry?.isIntersecting ?? false),
        { threshold: 0, rootMargin: '-40% 0px 0px 0px' },
      );
      observer.observe(el);
    };
    setup();

    return () => {
      if (rafHandle !== undefined) cancelAnimationFrame(rafHandle);
      observer?.disconnect();
    };
  }, [triggerElementId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (!isNearBottom) {
      setMoving(false);
      setHovered(false);
      return;
    }

    if (reducedMotion) {
      setMoving(false);
      setPositionX(getWalkBounds().min);
      setDirection('right');
      return;
    }

    if (hovered) {
      return;
    }

    let cancelled = false;
    let travelTimer: number | undefined;
    let pauseTimer: number | undefined;

    const walkToEdge = (nextDirection: Direction) => {
      if (cancelled) return;

      const bounds = getWalkBounds();
      const targetX = nextDirection === 'right' ? bounds.max : bounds.min;
      const span = Math.max(1, bounds.max - bounds.min);
      const distance = Math.abs(targetX - positionRef.current);
      const duration = Math.round(
        WALK_MIN_DURATION_MS + (distance / span) * (WALK_MAX_DURATION_MS - WALK_MIN_DURATION_MS),
      );

      setDirection(nextDirection);
      setWalkDurationMs(duration);
      setMoving(true);
      setPositionX(targetX);

      travelTimer = window.setTimeout(() => {
        if (cancelled) return;

        setMoving(false);
        nextGreeting();

        pauseTimer = window.setTimeout(
          () => {
            walkToEdge(nextDirection === 'right' ? 'left' : 'right');
          },
          1200 + Math.round(Math.random() * 1800),
        );
      }, duration);
    };

    pauseTimer = window.setTimeout(() => {
      walkToEdge(directionRef.current);
    }, 800);

    return () => {
      cancelled = true;
      if (travelTimer) window.clearTimeout(travelTimer);
      if (pauseTimer) window.clearTimeout(pauseTimer);
    };
  }, [isNearBottom, messagePool, reducedMotion, hovered]);

  const dinoCenterX = positionX + 14 + DINO_RENDER_SIZE / 2;
  const bubbleWidth = bubbleRef.current?.offsetWidth ?? 0;
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
  const bubbleLeft = dinoCenterX - bubbleWidth / 2;
  const bubbleRight = dinoCenterX + bubbleWidth / 2;
  const edgePadding = 12;
  let bubbleShiftX = 0;
  if (bubbleWidth > 0) {
    if (bubbleLeft < edgePadding) {
      bubbleShiftX = edgePadding - bubbleLeft;
    } else if (bubbleRight > viewportWidth - edgePadding) {
      bubbleShiftX = viewportWidth - edgePadding - bubbleRight;
    }
  }

  const speechBubble = (
    <span
      ref={bubbleRef}
      className="absolute top-3 flex flex-col items-center"
      style={{
        left: `${14 + DINO_RENDER_SIZE / 2}px`,
        opacity: hovered ? 1 : 0.92,
        transition:
          'opacity 220ms cubic-bezier(0.22, 1, 0.36, 1), transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
        transform: `translateX(calc(-50% + ${bubbleShiftX}px)) translateY(${hovered && hoverCapable ? '-4px' : '0'})`,
      }}
    >
      <span
        className="relative whitespace-nowrap rounded-full border px-4 py-2 text-[13px] font-medium tracking-[-0.01em] text-white shadow-[0_18px_42px_rgba(0,0,0,0.38)]"
        style={{
          background: hovered
            ? 'rgba(24,24,24,0.96)'
            : 'linear-gradient(180deg, rgba(22,22,22,0.96), rgba(10,10,10,0.94))',
          borderColor: hovered ? 'rgba(200,255,50,0.22)' : 'rgba(255,255,255,0.08)',
        }}
      >
        {greeting}
      </span>
      <span
        aria-hidden="true"
        className="mt-[-2px] h-3.5 w-3.5 rotate-45 border"
        style={{
          background: hovered ? 'rgba(24,24,24,0.96)' : 'rgba(14,14,14,0.96)',
          borderColor: hovered ? 'rgba(200,255,50,0.2)' : 'rgba(255,255,255,0.08)',
        }}
      />
    </span>
  );

  return (
    <>
      <style>{`
        @keyframes landing-mascot-idle {
          from { background-position: 0 0; }
          to { background-position: -${DINO_RENDER_SIZE * DINO_FRAME_COUNT}px 0; }
        }
      `}</style>
      <span
        aria-hidden={!isNearBottom}
        className="fixed bottom-4 left-0 z-[140]"
        style={{
          opacity: isNearBottom ? 1 : 0,
          pointerEvents: isNearBottom ? 'auto' : 'none',
          transform: `translateY(${isNearBottom ? '0' : '18px'})`,
          transition:
            'opacity 600ms cubic-bezier(0.22, 1, 0.36, 1), transform 600ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        <button
          ref={walkerRef}
          type="button"
          aria-label="Learn more about Ti and this project"
          tabIndex={isNearBottom ? 0 : -1}
          className="relative block border-0 bg-transparent p-0"
          style={{
            width: `${WALKER_WIDTH}px`,
            height: '164px',
            cursor: isNearBottom ? 'pointer' : 'default',
            transform: `translate3d(${positionX}px, 0, 0)`,
            transition: `transform ${moving ? walkDurationMs : 260}ms ${moving ? 'linear' : 'cubic-bezier(0.22, 1, 0.36, 1)'}`,
          }}
          onMouseEnter={() => {
            if (!hoverCapable) return;
            if (moving && walkerRef.current) {
              const rect = walkerRef.current.getBoundingClientRect();
              const currentX = rect.left;
              setPositionX(clampPosition(currentX));
              setMoving(false);
            }
            setHovered(true);
          }}
          onMouseLeave={() => {
            if (hoverCapable) setHovered(false);
          }}
          onFocus={() => {
            if (moving && walkerRef.current) {
              const rect = walkerRef.current.getBoundingClientRect();
              const currentX = rect.left;
              setPositionX(clampPosition(currentX));
              setMoving(false);
            }
            setHovered(true);
          }}
          onBlur={() => setHovered(false)}
          onClick={onActivate}
        >
          <span
            className="relative block h-full w-full"
            style={{
              transform: `translateY(${hovered && hoverCapable ? '-6px' : '0'})`,
              transition: 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          >
            {speechBubble}
            <span
              className="absolute bottom-0 left-0 block"
              style={{ width: `${WALKER_WIDTH}px`, height: `${WALKER_WIDTH}px` }}
            >
              <img
                src={dinoShadow}
                alt=""
                style={{
                  position: 'absolute',
                  left: '22px',
                  bottom: '10px',
                  width: '64px',
                  imageRendering: 'pixelated',
                  opacity: 0.75,
                }}
              />

              <span
                aria-hidden="true"
                className="absolute left-[14px] top-[10px] block"
                style={{
                  width: `${DINO_RENDER_SIZE}px`,
                  height: `${DINO_RENDER_SIZE}px`,
                  transform: direction === 'left' ? 'scaleX(-1)' : 'scaleX(1)',
                  transformOrigin: 'center',
                }}
              >
                {reducedMotion ? (
                  <img
                    src={dinoVitaFrame}
                    alt=""
                    style={{
                      width: `${DINO_RENDER_SIZE}px`,
                      height: `${DINO_RENDER_SIZE}px`,
                      imageRendering: 'pixelated',
                      filter: 'drop-shadow(0 14px 24px rgba(0,0,0,0.28))',
                    }}
                  />
                ) : (
                  <span
                    className="block overflow-hidden"
                    style={{
                      width: `${DINO_RENDER_SIZE}px`,
                      height: `${DINO_RENDER_SIZE}px`,
                      backgroundImage: `url(${moving ? dinoVitaWalkStrip : dinoVitaIdleStrip})`,
                      backgroundRepeat: 'no-repeat',
                      backgroundSize: `${DINO_RENDER_SIZE * DINO_FRAME_COUNT}px ${DINO_RENDER_SIZE}px`,
                      backgroundPosition: '0 0',
                      imageRendering: 'pixelated',
                      filter: 'drop-shadow(0 14px 24px rgba(0,0,0,0.28))',
                      animation: `landing-mascot-idle ${moving ? '0.48s' : '0.72s'} steps(${DINO_FRAME_COUNT}) infinite`,
                    }}
                  />
                )}
              </span>
            </span>
          </span>
        </button>
      </span>
    </>
  );
}
