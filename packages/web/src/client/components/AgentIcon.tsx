import { getAgentColor, getAgentGlyph, getAgentIcon, getAgentLabel } from '../lib/agent-colors.ts';
import { useAgentAvatarUrl } from './AgentAvatarContext.tsx';

const DARK_ICON_HEX = new Set(['000000', '0B100F', '191919']);

export function AgentIcon({
  agent,
  size = 14,
  avatarUrl,
}: {
  agent: string;
  size?: number;
  avatarUrl?: string;
}) {
  const contextAvatar = useAgentAvatarUrl(agent);
  const resolvedAvatarUrl = avatarUrl ?? contextAvatar;
  const dimension = `${size}px`;

  if (resolvedAvatarUrl) {
    return (
      <span
        aria-hidden="true"
        className="inline-flex items-center justify-center shrink-0 overflow-hidden rounded-full bg-bg"
        style={{
          width: dimension,
          height: dimension,
          minWidth: dimension,
          minHeight: dimension,
        }}
      >
        <img
          src={resolvedAvatarUrl}
          alt={getAgentLabel(agent)}
          width={size}
          height={size}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      </span>
    );
  }

  const icon = getAgentIcon(agent);

  if (icon?.imageSrc) {
    return (
      <span
        aria-hidden="true"
        className="inline-flex items-center justify-center shrink-0 overflow-hidden"
        style={{
          width: dimension,
          height: dimension,
          minWidth: dimension,
          minHeight: dimension,
        }}
      >
        <img
          src={icon.imageSrc}
          alt=""
          width={size}
          height={size}
          className="h-full w-full object-contain"
          loading="lazy"
        />
      </span>
    );
  }

  if (icon && (icon.path || icon.paths?.length)) {
    const iconHex = icon.hex.toUpperCase();
    const fill = DARK_ICON_HEX.has(iconHex) ? 'currentColor' : `#${icon.hex}`;
    return (
      <span
        aria-hidden="true"
        className="inline-flex items-center justify-center shrink-0 text-text"
        style={{
          width: dimension,
          height: dimension,
          minWidth: dimension,
          minHeight: dimension,
        }}
      >
        <svg
          aria-hidden="true"
          viewBox={icon.viewBox ?? '0 0 24 24'}
          width={size}
          height={size}
          fill="none"
        >
          {icon.paths?.length ? (
            icon.paths.map((segment) => (
              <path
                key={segment.d}
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
      className="inline-flex items-center justify-center shrink-0 rounded-full font-bold tracking-[0] leading-none"
      style={{
        width: dimension,
        height: dimension,
        minWidth: dimension,
        minHeight: dimension,
        background,
        color: getContrastTextColor(background),
        fontSize: `${Math.max(7, Math.floor(size * 0.58))}px`,
      }}
    >
      {getAgentGlyph(agent)}
    </span>
  );
}

function getContrastTextColor(hex: string): string {
  const normalized = hex.replace('#', '');
  if (!/^[0-9A-Fa-f]{6}$/.test(normalized)) return '#f4faef';
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.6 ? '#111610' : '#f4faef';
}
