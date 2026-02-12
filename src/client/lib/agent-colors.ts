import type { SimpleIcon } from 'simple-icons';
import { siAndroid, siClaude, siCursor, siGithubcopilot, siWindsurf } from 'simple-icons';

interface AgentBranding {
  label: string;
  color: string;
  icon?: SimpleIcon;
  fallbackGlyph?: string;
}

const DEFAULT_AGENT_COLOR = '#6b7280';

const AGENT_BRANDING: Record<string, AgentBranding> = {
  'claude-code': {
    label: 'Claude Code',
    color: '#8b5cf6',
    icon: siClaude,
  },
  'codex-cli': {
    label: 'Codex CLI',
    color: '#f97316',
    fallbackGlyph: 'CX',
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

export function getAgentIcon(agent: string): SimpleIcon | undefined {
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
