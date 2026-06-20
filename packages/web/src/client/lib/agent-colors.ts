import type { SimpleIcon } from 'simple-icons';
import { siCursor, siWindsurf } from 'simple-icons';
import codexIcon from '../assets/agent-icons/icon-codex.png';
import droidIcon from '../assets/agent-icons/icon-droid.png';
import geminiIcon from '../assets/agent-icons/icon-gemini.png';

interface AgentIconPath {
  d: string;
  fill?: string;
  fillRule?: 'evenodd' | 'nonzero';
  clipRule?: 'evenodd' | 'nonzero';
  fillOpacity?: number;
}

type AgentIcon = Partial<Pick<SimpleIcon, 'path'>> & {
  hex: string;
  imageSrc?: string;
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
const OPENCODE_ICON: AgentIcon = {
  hex: 'FFFFFF',
  viewBox: '0 0 32 32',
  paths: [
    {
      d: 'M3 32V0h26v32zM22 7H10v18h12z',
      fill: '#fff',
    },
    {
      d: 'M10 13h12v12H10z',
      fill: '#5a5858',
    },
  ],
};
const AMP_AGENT_ICON: AgentIcon = {
  hex: 'F34E3F',
  viewBox: '0 0 24 24',
  paths: [
    {
      d: 'M15.087 23.18L12.03 24l-2.097-7.823l-5.738 5.738l-2.251-2.251l5.718-5.719l-7.769-2.082l.82-3.057l11.294 3.08l3.08 11.295z',
      fill: '#F34E3F',
    },
    {
      d: 'M19.505 18.762l-3.057.82l-2.564-9.573l-9.572-2.564l.819-3.057l11.295 3.079l3.08 11.295z',
      fill: '#F34E3F',
    },
    {
      d: 'M23.893 14.374l-3.057.82l-2.565-9.572L8.7 3.057L9.52 0l11.295 3.08l3.079 11.294z',
      fill: '#F34E3F',
    },
  ],
};
const CLAUDE_ICON: AgentIcon = {
  hex: 'D97757',
  viewBox: '0 0 32 32',
  path: 'm6.283 21.28 6.293-3.531.106-.306-.106-.171h-.307l-1.051-.065-3.596-.097-3.118-.13-3.021-.162-.761-.161-.712-.94.073-.469.639-.429.916.08 2.023.138 3.037.209 2.203.13 3.263.339h.518l.073-.21-.177-.129-.138-.13-3.142-2.129-3.401-2.25-1.782-1.296-.963-.656-.486-.616-.21-1.343.875-.963 1.175.08.3.08 1.19.915 2.542 1.967 3.319 2.445.486.404.194-.138.024-.097-.218-.365-1.806-3.263-1.926-3.32-.857-1.375-.227-.825c-.08-.339-.138-.624-.138-.972L8.384.177 8.935 0l1.328.177.56.486.824 1.887 1.337 2.972 2.073 4.04.607 1.199.324 1.11.121.339h.21v-.194l.17-2.276.315-2.795.307-3.596.106-1.012.501-1.214.995-.657.778.372.639.916-.088.591-.381 2.471-.745 3.87-.485 2.591h.282l.324-.324 1.311-1.74 2.203-2.754.972-1.093 1.133-1.207.728-.574h1.376l1.013 1.505-.454 1.555-1.416 1.797-1.175 1.522-1.685 2.268-1.051 1.814.097.144.25-.023 3.805-.81 2.056-.372 2.454-.421 1.11.518.12.527-.436 1.078-2.624.648-3.077.615-4.582 1.084-.057.041.065.08 2.065.195.883.047h2.162l4.025.3 1.052.696.63.851-.106.647-1.619.825-2.186-.518-5.1-1.214-1.75-.436h-.242v.145l1.458 1.425 2.671 2.412 3.346 3.11.17.769-.43.607-.453-.065-2.939-2.211-1.134-.996-2.568-2.162h-.17v.227l.591.866 3.125 4.697.162 1.441-.226.468-.81.283-.89-.162-1.829-2.568-1.888-2.891-1.522-2.592-.186.106-.898 9.677-.421.495-.972.371-.81-.615-.43-.996.43-1.967.518-2.568.422-2.041.38-2.535.226-.842-.015-.056-.185.023-1.912 2.624-2.906 3.928-2.3 2.462-.551.218-.954-.494.088-.883.533-.787 3.184-4.049 1.919-2.509 1.24-1.449-.009-.21h-.073l-8.455 5.49-1.505.194-.648-.607.08-.995.307-.324 2.542-1.749-.009.008z',
};
const CODEX_ICON: AgentIcon = {
  hex: '463FFF',
  imageSrc: codexIcon,
};
const COPILOT_ICON: AgentIcon = {
  hex: 'FFFFFF',
  viewBox: '0 0 24 24',
  path: 'M19.245 5.364c1.322 1.36 1.877 3.216 2.11 5.817.622 0 1.2.135 1.592.654l.73.964c.21.278.323.61.323.955v2.62c0 .339-.173.669-.453.868C20.239 19.602 16.157 21.5 12 21.5c-4.6 0-9.205-2.583-11.547-4.258-.28-.2-.452-.53-.453-.868v-2.62c0-.345.113-.679.321-.956l.73-.963c.392-.517.974-.654 1.593-.654l.029-.297c.25-2.446.81-4.213 2.082-5.52 2.461-2.54 5.71-2.851 7.146-2.864h.198c1.436.013 4.685.323 7.146 2.864zm-7.244 4.328c-.284 0-.613.016-.962.05-.123.447-.305.85-.57 1.108-1.05 1.023-2.316 1.18-2.994 1.18-.638 0-1.306-.13-1.851-.464-.516.165-1.012.403-1.044.996a65.882 65.882 0 00-.063 2.884l-.002.48c-.002.563-.005 1.126-.013 1.69.002.326.204.63.51.765 2.482 1.102 4.83 1.657 6.99 1.657 2.156 0 4.504-.555 6.985-1.657a.854.854 0 00.51-.766c.03-1.682.006-3.372-.076-5.053-.031-.596-.528-.83-1.046-.996-.546.333-1.212.464-1.85.464-.677 0-1.942-.157-2.993-1.18-.266-.258-.447-.661-.57-1.108-.32-.032-.64-.049-.96-.05zm-2.525 4.013c.539 0 .976.426.976.95v1.753c0 .525-.437.95-.976.95a.964.964 0 01-.976-.95v-1.752c0-.525.437-.951.976-.951zm5 0c.539 0 .976.426.976.95v1.753c0 .525-.437.95-.976.95a.964.964 0 01-.976-.95v-1.752c0-.525.437-.951.976-.951zM7.635 5.087c-1.05.102-1.935.438-2.385.906-.975 1.037-.765 3.668-.21 4.224.405.394 1.17.657 1.995.657h.09c.649-.013 1.785-.176 2.73-1.11.435-.41.705-1.433.675-2.47-.03-.834-.27-1.52-.63-1.813-.39-.336-1.275-.482-2.265-.394zm6.465.394c-.36.292-.6.98-.63 1.813-.03 1.037.24 2.06.675 2.47.968.957 2.136 1.104 2.776 1.11h.044c.825 0 1.59-.263 1.995-.657.555-.556.765-3.187-.21-4.224-.45-.468-1.335-.804-2.385-.906-.99-.088-1.875.058-2.265.394zM12 7.615c-.24 0-.525.015-.84.044.03.16.045.336.06.526l-.001.159a2.94 2.94 0 01-.014.25c.225-.022.425-.027.612-.028h.366c.187 0 .387.006.612.028-.015-.146-.015-.277-.015-.409.015-.19.03-.365.06-.526a9.29 9.29 0 00-.84-.044z',
};
const DROID_ICON: AgentIcon = {
  hex: 'FA4B3E',
  imageSrc: droidIcon,
};
const GEMINI_ICON: AgentIcon = {
  hex: '1E88E5',
  imageSrc: geminiIcon,
};
const KIRO_ICON: AgentIcon = {
  hex: '9046FF',
  viewBox: '0 0 1200 1200',
  paths: [
    {
      d: 'M260 0h680c143.594 0 260 116.406 260 260v680c0 143.594-116.406 260-260 260H260C116.406 1200 0 1083.594 0 940V260C0 116.406 116.406 0 260 0Z',
      fill: '#9046FF',
    },
    {
      d: 'M398.554 818.914C316.315 1001.03 491.477 1046.74 620.672 940.156C658.687 1059.66 801.052 970.473 852.234 877.795C964.787 673.567 919.318 465.357 907.64 422.374C827.637 129.443 427.623 128.946 358.8 423.865C342.651 475.544 342.402 534.18 333.458 595.051C328.986 625.86 325.507 645.488 313.83 677.785C306.873 696.424 297.68 712.819 282.773 740.645C259.915 783.881 269.604 867.113 387.87 823.883L399.051 818.914H398.554Z',
      fill: '#fff',
    },
    {
      d: 'M636.123 549.353C603.328 549.353 598.359 510.097 598.359 486.742C598.359 465.623 602.086 448.977 609.293 438.293C615.504 428.852 624.697 424.131 636.123 424.131C647.555 424.131 657.492 428.852 664.447 438.541C672.398 449.474 676.623 466.12 676.623 486.742C676.623 525.998 661.471 549.353 636.375 549.353H636.123Z',
      fill: '#000',
    },
    {
      d: 'M771.24 549.353C738.445 549.353 733.477 510.097 733.477 486.742C733.477 465.623 737.203 448.977 744.41 438.293C750.621 428.852 759.814 424.131 771.24 424.131C782.672 424.131 792.609 428.852 799.564 438.541C807.516 449.474 811.74 466.12 811.74 486.742C811.74 525.998 796.588 549.353 771.492 549.353H771.24Z',
      fill: '#000',
    },
  ],
};
const PI_ICON: AgentIcon = {
  hex: 'FFFFFF',
  viewBox: '0 0 800 800',
  paths: [
    {
      d: 'M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z',
      fill: '#fff',
      fillRule: 'evenodd',
    },
    {
      d: 'M517.36 400H634.72V634.72H517.36Z',
      fill: '#fff',
    },
  ],
};
const VSCODE_ICON: AgentIcon = {
  hex: '007ACC',
  viewBox: '0 0 100 100',
  paths: [
    {
      d: 'M96.4614 10.7962L75.8569 0.875542C73.4719-0.272773 70.6217 0.211611 68.75 2.08333L1.29858 63.5832C-0.515693 65.2373-0.513607 68.0937 1.30308 69.7452L6.81272 74.754C8.29793 76.1042 10.5347 76.2036 12.1338 74.9905L93.3609 13.3699C96.086 11.3026 100 13.2462 100 16.6667V16.4275C100 14.0265 98.6246 11.8378 96.4614 10.7962Z',
      fill: '#0065A9',
    },
    {
      d: 'M96.4614 89.2038L75.8569 99.1245C73.4719 100.273 70.6217 99.7884 68.75 97.9167L1.29858 36.4169C-0.515693 34.7627-0.513607 31.9063 1.30308 30.2548L6.81272 25.246C8.29793 23.8958 10.5347 23.7964 12.1338 25.0095L93.3609 86.6301C96.086 88.6974 100 86.7538 100 83.3334V83.5726C100 85.9735 98.6246 88.1622 96.4614 89.2038Z',
      fill: '#007ACC',
    },
    {
      d: 'M75.8578 99.1263C73.4721 100.274 70.6219 99.7885 68.75 97.9166C71.0564 100.223 75 98.5895 75 95.3278V4.67213C75 1.41039 71.0564-0.223106 68.75 2.08329C70.6219 0.211402 73.4721-0.273666 75.8578 0.873633L96.4587 10.7807C98.6234 11.8217 100 14.0112 100 16.4132V83.5871C100 85.9891 98.6234 88.1786 96.4586 89.2196L75.8578 99.1263Z',
      fill: '#1F9CF0',
    },
  ],
};

const AGENT_BRANDING: Record<string, AgentBranding> = {
  'claude-code': {
    label: 'Claude Code',
    color: '#8b5cf6',
    icon: CLAUDE_ICON,
  },
  'codex-cli': {
    label: 'Codex CLI',
    color: '#f97316',
    icon: CODEX_ICON,
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
    color: '#ff5f3d',
    icon: AMP_AGENT_ICON,
  },
  gemini: {
    label: 'Gemini',
    color: '#1e88e5',
    icon: GEMINI_ICON,
  },
  cline: {
    label: 'Cline',
    color: '#06b6d4',
    fallbackGlyph: 'CL',
  },
  'copilot-chat': {
    label: 'GitHub Copilot',
    color: '#6b7280',
    icon: COPILOT_ICON,
  },
  droid: {
    label: 'Droid',
    color: '#ef4444',
    icon: DROID_ICON,
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
  vscode: {
    label: 'VS Code',
    color: '#007acc',
    icon: VSCODE_ICON,
  },
  aider: {
    label: 'Aider',
    color: '#6366f1',
    fallbackGlyph: 'AI',
  },
  kiro: {
    label: 'Kiro',
    color: '#9046ff',
    icon: KIRO_ICON,
  },
  pi: {
    label: 'Pi',
    color: '#f4f7f1',
    icon: PI_ICON,
  },
};

export const AGENT_IDS = Object.keys(AGENT_BRANDING);

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
    .map((part) => (part ? (part[0]?.toUpperCase() ?? '') + part.slice(1) : part))
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
