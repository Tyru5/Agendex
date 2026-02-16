import type { SimpleIcon } from 'simple-icons';
import { siAndroid, siClaude, siCursor, siGithubcopilot, siWindsurf } from 'simple-icons';

interface AgentIconPath {
  d: string;
  fill?: string;
  fillRule?: 'evenodd' | 'nonzero';
  clipRule?: 'evenodd' | 'nonzero';
  fillOpacity?: number;
}

type AgentIcon = Pick<SimpleIcon, 'hex' | 'path'> & {
  viewBox?: string;
  paths?: AgentIconPath[];
};

interface AgentBranding {
  label: string;
  color: string;
  icon?: AgentIcon;
  fallbackGlyph?: string;
}

const DEFAULT_AGENT_COLOR = '#6b7280';
const OPENAI_ICON: AgentIcon = {
  hex: '000000',
  path: 'M22.282 9.821a5.985 5.985 0 0 0-.516-4.91a6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9a6.046 6.046 0 0 0 .743 7.097a5.98 5.98 0 0 0 .51 4.911a6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206a5.99 5.99 0 0 0 3.997-2.9a6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081l4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085l4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355l-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085l-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5l2.607 1.5v2.999l-2.597 1.5l-2.607-1.5Z',
};
const OPENCODE_ICON: AgentIcon = {
  hex: '000000',
  path: 'M180 240H60V120H180V240ZM180 60H60V240H180V60ZM240 300H0V0H240V300Z',
  viewBox: '0 0 240 300',
  paths: [
    {
      d: 'M180 240H60V120H180V240Z',
      fill: 'currentColor',
      fillOpacity: 0.35,
    },
    {
      d: 'M180 60H60V240H180V60ZM240 300H0V0H240V300Z',
      fill: 'currentColor',
      fillRule: 'evenodd',
      clipRule: 'evenodd',
    },
  ],
};

const AGENT_BRANDING: Record<string, AgentBranding> = {
  'claude-code': {
    label: 'Claude Code',
    color: '#8b5cf6',
    icon: siClaude,
  },
  'codex-cli': {
    label: 'Codex CLI',
    color: '#f97316',
    icon: OPENAI_ICON,
  },
  'continue-ide': {
    label: 'Continue IDE',
    color: '#3b82f6',
    fallbackGlyph: 'CT',
  },
  cursor: {
    label: 'Cursor',
    color: '#22c55e',
    icon: siCursor,
  },
  amp: {
    label: 'Amp',
    color: '#ec4899',
    fallbackGlyph: 'AP',
  },
  cline: {
    label: 'Cline',
    color: '#06b6d4',
    fallbackGlyph: 'CL',
  },
  'copilot-chat': {
    label: 'GitHub Copilot',
    color: '#6b7280',
    icon: siGithubcopilot,
  },
  droid: {
    label: 'Droid',
    color: '#ef4444',
    icon: siAndroid,
  },
  'kilo-cli': {
    label: 'Kilo CLI',
    color: '#eab308',
    fallbackGlyph: 'KL',
  },
  windsurf: {
    label: 'Windsurf',
    color: '#14b8a6',
    icon: siWindsurf,
  },
  'oh-my-opencode': {
    label: 'OpenCode',
    color: '#131010',
    icon: OPENCODE_ICON,
  },
  aider: {
    label: 'Aider',
    color: '#6366f1',
    fallbackGlyph: 'AI',
  },
};

export const AGENT_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(AGENT_BRANDING).map(([agent, branding]) => [agent, branding.color]),
) as Record<string, string>;

export function getAgentColor(agent: string): string {
  return AGENT_BRANDING[normalizeAgent(agent)]?.color ?? DEFAULT_AGENT_COLOR;
}

export function getAgentLabel(agent: string): string {
  return AGENT_BRANDING[normalizeAgent(agent)]?.label ?? formatAgentLabel(agent);
}

export function getAgentIcon(agent: string): AgentIcon | undefined {
  return AGENT_BRANDING[normalizeAgent(agent)]?.icon;
}

export function getAgentGlyph(agent: string): string {
  const branding = AGENT_BRANDING[normalizeAgent(agent)];
  if (branding?.fallbackGlyph) return branding.fallbackGlyph;
  return getInitials(branding?.label ?? formatAgentLabel(agent));
}

function normalizeAgent(agent: string): string {
  return agent.trim().toLowerCase();
}

function formatAgentLabel(agent: string): string {
  const normalized = agent.trim();
  if (!normalized) return 'Unknown Agent';
  return normalized
    .split('-')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}

function getInitials(text: string): string {
  const compact = text.trim();
  if (!compact) return '?';
  return compact
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
