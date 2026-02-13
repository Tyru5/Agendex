import { getAgentColor, getAgentGlyph, getAgentIcon } from '../lib/agent-colors.ts';

const DARK_ICON_HEX = new Set(['000000', '0B100F', '191919']);

export function AgentIcon({ agent, size = 14 }: { agent: string; size?: number }) {
  const icon = getAgentIcon(agent);
  const dimension = `${size}px`;

  if (icon && (icon.path || icon.paths?.length)) {
    const iconHex = icon.hex.toUpperCase();
    const fill = DARK_ICON_HEX.has(iconHex) ? 'currentColor' : `#${icon.hex}`;
    return (
      <span
        aria-hidden="true"
        style={{
          width: dimension,
          height: dimension,
          minWidth: dimension,
          minHeight: dimension,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text)',
          flexShrink: 0,
        }}
      >
        <svg viewBox={icon.viewBox ?? '0 0 24 24'} width={size} height={size} fill="none">
          {icon.paths?.length ? (
            icon.paths.map((segment, index) => (
              <path
                key={`${agent}-${index}`}
                d={segment.d}
                fill={segment.fill ?? fill}
                fillRule={segment.fillRule}
                clipRule={segment.clipRule}
                fillOpacity={segment.fillOpacity}
              />
            ))
          ) : icon.path ? (
            <path d={icon.path} fill={fill} />
          ) : null}
        </svg>
      </span>
    );
  }

  const background = getAgentColor(agent);
  return (
    <span
      aria-hidden="true"
      style={{
        width: dimension,
        height: dimension,
        minWidth: dimension,
        minHeight: dimension,
        borderRadius: '999px',
        background,
        color: getContrastTextColor(background),
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: `${Math.max(7, Math.floor(size * 0.58))}px`,
        fontWeight: 700,
        letterSpacing: '-0.02em',
        lineHeight: 1,
        flexShrink: 0,
      }}
    >
      {getAgentGlyph(agent)}
    </span>
  );
}

function getContrastTextColor(hex: string): string {
  const normalized = hex.replace('#', '');
  if (!/^[0-9A-Fa-f]{6}$/.test(normalized)) return '#ffffff';
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.6 ? '#111111' : '#ffffff';
}
