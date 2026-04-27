import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentAdapter } from '../types.ts';
import { claudeCodeAdapter } from './claude-code.ts';
import { codexCliAdapter } from './codex-cli.ts';
import { continueIdeAdapter } from './continue-ide.ts';
import { cursorAdapter } from './cursor.ts';
import { ohMyOpencodeAdapter } from './oh-my-opencode.ts';
import { plannotatorAdapter } from './plannotator.ts';
import { createStubAdapter } from './stub.ts';

export type AdapterGroup = 'universal' | 'other';

export type SkillsAdapterId =
  | 'amp'
  | 'antigravity'
  | 'augment'
  | 'claude-code'
  | 'openclaw'
  | 'cline'
  | 'codebuddy'
  | 'codex'
  | 'command-code'
  | 'continue'
  | 'crush'
  | 'cursor'
  | 'droid'
  | 'gemini-cli'
  | 'github-copilot'
  | 'goose'
  | 'junie'
  | 'iflow-cli'
  | 'kilo'
  | 'kimi-cli'
  | 'kiro-cli'
  | 'kode'
  | 'mcpjam'
  | 'mistral-vibe'
  | 'mux'
  | 'opencode'
  | 'openhands'
  | 'pi'
  | 'plannotator'
  | 'qoder'
  | 'qwen-code'
  | 'replit'
  | 'roo'
  | 'trae'
  | 'trae-cn'
  | 'windsurf'
  | 'zencoder'
  | 'neovate'
  | 'pochi'
  | 'adal';

export type AdapterId = SkillsAdapterId | 'aider';

export interface AdapterCatalogEntry {
  id: AdapterId;
  displayName: string;
  group: AdapterGroup;
  implemented: boolean;
  defaultEnabled: boolean;
  locked?: boolean;
  createAdapter: () => AgentAdapter;
}

const home = homedir();

export const ADAPTER_AGENT_ALIASES: Record<AdapterId, string> = {
  amp: 'amp',
  antigravity: 'antigravity',
  augment: 'augment',
  'claude-code': 'claude-code',
  openclaw: 'openclaw',
  cline: 'cline',
  codebuddy: 'codebuddy',
  codex: 'codex-cli',
  'command-code': 'command-code',
  continue: 'continue-ide',
  crush: 'crush',
  cursor: 'cursor',
  droid: 'droid',
  'gemini-cli': 'gemini-cli',
  'github-copilot': 'copilot-chat',
  goose: 'goose',
  junie: 'junie',
  'iflow-cli': 'iflow-cli',
  kilo: 'kilo-cli',
  'kimi-cli': 'kimi-cli',
  'kiro-cli': 'kiro-cli',
  kode: 'kode',
  mcpjam: 'mcpjam',
  'mistral-vibe': 'mistral-vibe',
  mux: 'mux',
  opencode: 'oh-my-opencode',
  openhands: 'openhands',
  pi: 'pi',
  plannotator: 'plannotator',
  qoder: 'qoder',
  'qwen-code': 'qwen-code',
  replit: 'replit',
  roo: 'roo',
  trae: 'trae',
  'trae-cn': 'trae-cn',
  windsurf: 'windsurf',
  zencoder: 'zencoder',
  neovate: 'neovate',
  pochi: 'pochi',
  adal: 'adal',
  aider: 'aider',
};

const CATALOG: AdapterCatalogEntry[] = [
  {
    id: 'amp',
    displayName: 'Amp',
    group: 'universal',
    implemented: false,
    defaultEnabled: true,
    createAdapter: () => createStubAdapter('amp', [join(home, '.amp')], '.json'),
  },
  {
    id: 'antigravity',
    displayName: 'Antigravity',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () =>
      createStubAdapter('antigravity', [join(home, '.gemini', 'antigravity')], '.json'),
  },
  {
    id: 'augment',
    displayName: 'Augment',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('augment', [join(home, '.augment')], '.json'),
  },
  {
    id: 'claude-code',
    displayName: 'Claude Code',
    group: 'other',
    implemented: true,
    defaultEnabled: true,
    createAdapter: () => claudeCodeAdapter,
  },
  {
    id: 'openclaw',
    displayName: 'OpenClaw',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('openclaw', [join(home, '.openclaw')], '.md'),
  },
  {
    id: 'cline',
    displayName: 'Cline',
    group: 'other',
    implemented: false,
    defaultEnabled: true,
    createAdapter: () =>
      createStubAdapter(
        'cline',
        [
          join(
            home,
            'AppData',
            'Roaming',
            'Code',
            'User',
            'globalStorage',
            'saoudrizwan.claude-dev',
          ),
          join(home, '.config', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev'),
        ],
        '.json',
      ),
  },
  {
    id: 'codebuddy',
    displayName: 'CodeBuddy',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('codebuddy', [join(home, '.codebuddy')], '.md'),
  },
  {
    id: 'codex',
    displayName: 'Codex',
    group: 'universal',
    implemented: true,
    defaultEnabled: true,
    createAdapter: () => codexCliAdapter,
  },
  {
    id: 'command-code',
    displayName: 'Command Code',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('command-code', [join(home, '.commandcode')], '.md'),
  },
  {
    id: 'continue',
    displayName: 'Continue',
    group: 'other',
    implemented: true,
    defaultEnabled: true,
    createAdapter: () => continueIdeAdapter,
  },
  {
    id: 'crush',
    displayName: 'Crush',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('crush', [join(home, '.config', 'crush')], '.json'),
  },
  {
    id: 'cursor',
    displayName: 'Cursor',
    group: 'other',
    implemented: true,
    defaultEnabled: true,
    createAdapter: () => cursorAdapter,
  },
  {
    id: 'droid',
    displayName: 'Droid',
    group: 'other',
    implemented: false,
    defaultEnabled: true,
    createAdapter: () => createStubAdapter('droid', [join(home, '.factory', 'droids')], '.md'),
  },
  {
    id: 'gemini-cli',
    displayName: 'Gemini CLI',
    group: 'universal',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('gemini-cli', [join(home, '.gemini')], '.md'),
  },
  {
    id: 'github-copilot',
    displayName: 'GitHub Copilot',
    group: 'universal',
    implemented: false,
    defaultEnabled: true,
    createAdapter: () =>
      createStubAdapter(
        'copilot-chat',
        [join(home, '.vscode', 'User', 'workspaceStorage')],
        '.json',
      ),
  },
  {
    id: 'goose',
    displayName: 'Goose',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('goose', [join(home, '.config', 'goose')], '.json'),
  },
  {
    id: 'junie',
    displayName: 'Junie',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('junie', [join(home, '.junie')], '.json'),
  },
  {
    id: 'iflow-cli',
    displayName: 'iFlow CLI',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('iflow-cli', [join(home, '.iflow')], '.json'),
  },
  {
    id: 'kilo',
    displayName: 'Kilo Code',
    group: 'other',
    implemented: false,
    defaultEnabled: true,
    createAdapter: () => createStubAdapter('kilo-cli', [join(home, '.kilo')], '.md'),
  },
  {
    id: 'kimi-cli',
    displayName: 'Kimi Code CLI',
    group: 'universal',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('kimi-cli', [join(home, '.kimi')], '.md'),
  },
  {
    id: 'kiro-cli',
    displayName: 'Kiro CLI',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('kiro-cli', [join(home, '.kiro')], '.json'),
  },
  {
    id: 'kode',
    displayName: 'Kode',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('kode', [join(home, '.kode')], '.json'),
  },
  {
    id: 'mcpjam',
    displayName: 'MCPJam',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('mcpjam', [join(home, '.mcpjam')], '.json'),
  },
  {
    id: 'mistral-vibe',
    displayName: 'Mistral Vibe',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('mistral-vibe', [join(home, '.vibe')], '.json'),
  },
  {
    id: 'mux',
    displayName: 'Mux',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('mux', [join(home, '.mux')], '.json'),
  },
  {
    id: 'opencode',
    displayName: 'OpenCode',
    group: 'universal',
    implemented: true,
    defaultEnabled: true,
    createAdapter: () => ohMyOpencodeAdapter,
  },
  {
    id: 'openhands',
    displayName: 'OpenHands',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('openhands', [join(home, '.openhands')], '.json'),
  },
  {
    id: 'pi',
    displayName: 'Pi',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('pi', [join(home, '.pi', 'agent')], '.md'),
  },
  {
    id: 'plannotator',
    displayName: 'Plannotator',
    group: 'universal',
    implemented: true,
    defaultEnabled: false,
    createAdapter: () => plannotatorAdapter,
  },
  {
    id: 'qoder',
    displayName: 'Qoder',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('qoder', [join(home, '.qoder')], '.json'),
  },
  {
    id: 'qwen-code',
    displayName: 'Qwen Code',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('qwen-code', [join(home, '.qwen')], '.json'),
  },
  {
    id: 'replit',
    displayName: 'Replit',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('replit', [join(home, '.replit')], '.md'),
  },
  {
    id: 'roo',
    displayName: 'Roo Code',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('roo', [join(home, '.roo')], '.md'),
  },
  {
    id: 'trae',
    displayName: 'Trae',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('trae', [join(home, '.trae')], '.md'),
  },
  {
    id: 'trae-cn',
    displayName: 'Trae CN',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('trae-cn', [join(home, '.trae-cn')], '.md'),
  },
  {
    id: 'windsurf',
    displayName: 'Windsurf',
    group: 'other',
    implemented: false,
    defaultEnabled: true,
    createAdapter: () => createStubAdapter('windsurf', [join(home, '.cascade_backups')], '.md'),
  },
  {
    id: 'zencoder',
    displayName: 'Zencoder',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('zencoder', [join(home, '.zencoder')], '.json'),
  },
  {
    id: 'neovate',
    displayName: 'Neovate',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('neovate', [join(home, '.neovate')], '.json'),
  },
  {
    id: 'pochi',
    displayName: 'Pochi',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('pochi', [join(home, '.pochi')], '.json'),
  },
  {
    id: 'adal',
    displayName: 'AdaL',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('adal', [join(home, '.adal')], '.json'),
  },
  {
    id: 'aider',
    displayName: 'Aider',
    group: 'other',
    implemented: false,
    defaultEnabled: true,
    createAdapter: () =>
      createStubAdapter('aider', [join(home, '.aider')], '.aider.chat.history.md'),
  },
];

export function getAdapterCatalog(): AdapterCatalogEntry[] {
  return CATALOG.map((entry) => ({ ...entry }));
}

export function getCatalogAdapterIds(): AdapterId[] {
  return CATALOG.map((entry) => entry.id);
}

export function getCatalogDefaultAdapterIds(): AdapterId[] {
  return CATALOG.filter((entry) => entry.defaultEnabled).map((entry) => entry.id);
}

export function isAdapterId(value: string): value is AdapterId {
  return CATALOG.some((entry) => entry.id === value);
}

const LEGACY_TO_ADAPTER_ID = new Map<string, AdapterId>(
  Object.entries(ADAPTER_AGENT_ALIASES).map(([adapterId, agent]) => [
    agent,
    adapterId as AdapterId,
  ]),
);

export function resolveAdapterId(value: string): AdapterId | undefined {
  if (isAdapterId(value)) return value;
  return LEGACY_TO_ADAPTER_ID.get(value);
}
