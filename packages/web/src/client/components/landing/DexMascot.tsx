import type { CSSProperties } from 'react';

export type DexVariant = 'dark' | 'light';

export interface DexMascotProps {
  /**
   * `dark` renders an ivory owl for dark surfaces (the landing background).
   * `light` renders a deep-teal owl for light surfaces.
   */
  variant?: DexVariant;
  size?: number;
  title?: string;
  className?: string;
  style?: CSSProperties;
}

interface DexPalette {
  body: string;
  bodyShade: string;
  tuft: string;
  face: string;
  card: string;
  cardLine: string;
}

// Brand palette (see DESIGN.md).
const EYE = '#c8ff32';
const PUPIL = '#041f1d';
const BEAK = '#ff7a2f';

const PALETTES: Record<DexVariant, DexPalette> = {
  // Ivory owl for dark surfaces; the plan cards go deep teal so the indexed
  // stack still reads against the light body.
  dark: {
    body: '#eef4e8',
    bodyShade: '#c3d1c0',
    tuft: '#dfe7d6',
    face: '#f6faf1',
    card: '#0f3b36',
    cardLine: '#c8ff32',
  },
  // Deep-teal owl for light surfaces; ivory plan cards pop against the body.
  light: {
    body: '#082724',
    bodyShade: '#0f3b36',
    tuft: '#0b322e',
    face: '#123f39',
    card: '#eef4e8',
    cardLine: '#879891',
  },
};

/**
 * Dex, the Agendex owl mascot. A friendly, minimal geometric owl whose belly is
 * a stack of neatly indexed plan cards — wise, calm oversight of your agent plans.
 * Rendered as a crisp, theme-aware SVG so it scales to any surface.
 */
export function DexMascot({
  variant = 'dark',
  size = 40,
  title = 'Dex, the Agendex owl',
  className,
  style,
}: DexMascotProps) {
  const p = PALETTES[variant];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      role="img"
      aria-label={title}
      className={className}
      style={style}
    >
      <title>{title}</title>

      {/* Ear tufts */}
      <path d="M34 30 Q27 9 40 6 Q47 16 48 28 Z" fill={p.tuft} />
      <path d="M86 30 Q93 9 80 6 Q73 16 72 28 Z" fill={p.tuft} />

      {/* Body */}
      <path
        d="M28 54 C28 31 42 18 60 18 C78 18 92 31 92 54 L92 84 C92 99 79 108 60 108 C41 108 28 99 28 84 Z"
        fill={p.body}
      />
      {/* Wing shading on each side for depth */}
      <path
        d="M28 60 C28 82 34 100 46 105 C36 100 33 82 34 60 Z"
        fill={p.bodyShade}
        opacity={0.55}
      />
      <path
        d="M92 60 C92 82 86 100 74 105 C84 100 87 82 86 60 Z"
        fill={p.bodyShade}
        opacity={0.55}
      />

      {/* Face disc */}
      <path
        d="M32 50 C32 33 44 23 60 23 C76 23 88 33 88 50 C88 63 76 70 60 70 C44 70 32 63 32 50 Z"
        fill={p.face}
      />

      {/* Eyes */}
      <circle cx="46" cy="47" r="13" fill={EYE} />
      <circle cx="74" cy="47" r="13" fill={EYE} />
      <circle cx="46" cy="47" r="5.4" fill={PUPIL} />
      <circle cx="74" cy="47" r="5.4" fill={PUPIL} />
      <circle cx="48.1" cy="44.9" r="1.7" fill="#ffffff" />
      <circle cx="76.1" cy="44.9" r="1.7" fill="#ffffff" />

      {/* Beak */}
      <path d="M60 52 L65 59 L60 68 L55 59 Z" fill={BEAK} />

      {/* Belly: stack of indexed plan cards */}
      <rect x="37" y="70" width="46" height="16" rx="5" fill={p.card} />
      <rect x="40" y="86" width="40" height="9" rx="4" fill={p.card} opacity={0.85} />
      <rect x="43" y="95" width="34" height="8" rx="4" fill={p.card} opacity={0.7} />
      {/* Index line on the top card */}
      <circle cx="45" cy="78" r="1.8" fill={p.cardLine} />
      <rect x="50" y="77" width="26" height="2.2" rx="1.1" fill={p.cardLine} />

      {/* Feet */}
      <rect x="50" y="104" width="8" height="7" rx="3.5" fill={p.bodyShade} />
      <rect x="62" y="104" width="8" height="7" rx="3.5" fill={p.bodyShade} />
    </svg>
  );
}
