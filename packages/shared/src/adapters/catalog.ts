import { join } from 'node:path';
import { getHomeDir } from '../config.ts';
import type { AgentAdapter } from '../types.ts';
import { claudeCodeAdapter } from './claude-code.ts';
import { codexCliAdapter } from './codex-cli.ts';
import { continueIdeAdapter } from './continue-ide.ts';
import { cursorAdapter } from './cursor.ts';
import {
  antigravityAdapter,
  codeBuddyAdapter,
  commandCodeAdapter,
  droidAdapter,
  geminiCliAdapter,
  githubCopilotAdapter,
  junieAdapter,
  kiloAdapter,
  kimiCodeAdapter,
  kiroAdapter,
  muxAdapter,
  qwenCodeAdapter,
  windsurfAdapter,
} from './file-artifact-adapters.ts';
import { grokAdapter } from './grok.ts';
import { ohMyOpencodeAdapter } from './oh-my-opencode.ts';
import { openCodeAdapter } from './opencode.ts';
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
  | 'commandcode'
  | 'continue'
  | 'crush'
  | 'cursor'
  | 'droid'
  | 'gemini-cli'
  | 'github-copilot'
  | 'goose'
  | 'grok'
  | 'junie'
  | 'iflow-cli'
  | 'kilo'
  | 'kimi-cli'
  | 'kiro-cli'
  | 'kode'
  | 'mistral-vibe'
  | 'mux'
  | 'opencode'
  | 'oh-my-opencode'
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

export const ADAPTER_AGENT_ALIASES: Record<AdapterId, string> = {
  amp: 'amp',
  antigravity: 'antigravity',
  augment: 'augment',
  'claude-code': 'claude-code',
  openclaw: 'openclaw',
  cline: 'cline',
  codebuddy: 'codebuddy',
  codex: 'codex-cli',
  commandcode: 'commandcode',
  continue: 'continue-ide',
  crush: 'crush',
  cursor: 'cursor',
  droid: 'droid',
  'gemini-cli': 'gemini-cli',
  'github-copilot': 'copilot-chat',
  goose: 'goose',
  grok: 'grok',
  junie: 'junie',
  'iflow-cli': 'iflow-cli',
  kilo: 'kilo-cli',
  'kimi-cli': 'kimi-cli',
  'kiro-cli': 'kiro-cli',
  kode: 'kode',
  'mistral-vibe': 'mistral-vibe',
  mux: 'mux',
  opencode: 'opencode',
  'oh-my-opencode': 'oh-my-opencode',
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
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('amp', [join(getHomeDir(), '.amp')], '.json'),
  },
  {
    id: 'antigravity',
    displayName: 'Antigravity',
    group: 'other',
    implemented: true,
    defaultEnabled: true,
    createAdapter: () => antigravityAdapter,
  },
  {
    id: 'augment',
    displayName: 'Augment',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('augment', [join(getHomeDir(), '.augment')], '.json'),
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
    createAdapter: () => createStubAdapter('openclaw', [join(getHomeDir(), '.openclaw')], '.md'),
  },
  {
    id: 'cline',
    displayName: 'Cline',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () =>
      createStubAdapter(
        'cline',
        [
          join(
            getHomeDir(),
            'AppData',
            'Roaming',
            'Code',
            'User',
            'globalStorage',
            'saoudrizwan.claude-dev',
          ),
          join(getHomeDir(), '.config', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev'),
        ],
        '.json',
      ),
  },
  {
    id: 'codebuddy',
    displayName: 'CodeBuddy',
    group: 'other',
    implemented: true,
    defaultEnabled: true,
    createAdapter: () => codeBuddyAdapter,
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
    id: 'commandcode',
    displayName: 'Command Code',
    group: 'other',
    implemented: true,
    defaultEnabled: true,
    createAdapter: () => commandCodeAdapter,
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
    createAdapter: () => createStubAdapter('crush', [join(getHomeDir(), '.config', 'crush')], '.json'),
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
    displayName: 'Factory Droid',
    group: 'other',
    implemented: true,
    defaultEnabled: true,
    createAdapter: () => droidAdapter,
  },
  {
    id: 'gemini-cli',
    displayName: 'Gemini CLI',
    group: 'universal',
    implemented: true,
    defaultEnabled: true,
    createAdapter: () => geminiCliAdapter,
  },
  {
    id: 'github-copilot',
    displayName: 'GitHub Copilot',
    group: 'universal',
    implemented: true,
    defaultEnabled: true,
    createAdapter: () => githubCopilotAdapter,
  },
  {
    id: 'goose',
    displayName: 'Goose',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('goose', [join(getHomeDir(), '.config', 'goose')], '.json'),
  },
  {
    id: 'grok',
    displayName: 'Grok',
    group: 'universal',
    implemented: true,
    defaultEnabled: true,
    createAdapter: () => grokAdapter,
  },
  {
    id: 'junie',
    displayName: 'Junie',
    group: 'other',
    implemented: true,
    defaultEnabled: true,
    createAdapter: () => junieAdapter,
  },
  {
    id: 'iflow-cli',
    displayName: 'iFlow CLI',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('iflow-cli', [join(getHomeDir(), '.iflow')], '.json'),
  },
  {
    id: 'kilo',
    displayName: 'Kilo Code',
    group: 'other',
    implemented: true,
    defaultEnabled: true,
    createAdapter: () => kiloAdapter,
  },
  {
    id: 'kimi-cli',
    displayName: 'Kimi Code CLI',
    group: 'universal',
    implemented: true,
    defaultEnabled: true,
    createAdapter: () => kimiCodeAdapter,
  },
  {
    id: 'kiro-cli',
    displayName: 'Kiro CLI',
    group: 'other',
    implemented: true,
    defaultEnabled: true,
    createAdapter: () => kiroAdapter,
  },
  {
    id: 'kode',
    displayName: 'Kode',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('kode', [join(getHomeDir(), '.kode')], '.json'),
  },
  {
    id: 'mistral-vibe',
    displayName: 'Mistral Vibe',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('mistral-vibe', [join(getHomeDir(), '.vibe')], '.json'),
  },
  {
    id: 'mux',
    displayName: 'Mux',
    group: 'other',
    implemented: true,
    defaultEnabled: true,
    createAdapter: () => muxAdapter,
  },
  {
    id: 'opencode',
    displayName: 'OpenCode',
    group: 'universal',
    implemented: true,
    defaultEnabled: true,
    createAdapter: () => openCodeAdapter,
  },
  {
    id: 'oh-my-opencode',
    displayName: 'Oh My OpenCode',
    group: 'other',
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
    createAdapter: () => createStubAdapter('openhands', [join(getHomeDir(), '.openhands')], '.json'),
  },
  {
    id: 'pi',
    displayName: 'Pi',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('pi', [join(getHomeDir(), '.pi', 'agent')], '.md'),
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
    createAdapter: () => createStubAdapter('qoder', [join(getHomeDir(), '.qoder')], '.json'),
  },
  {
    id: 'qwen-code',
    displayName: 'Qwen Code',
    group: 'other',
    implemented: true,
    defaultEnabled: true,
    createAdapter: () => qwenCodeAdapter,
  },
  {
    id: 'replit',
    displayName: 'Replit',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('replit', [join(getHomeDir(), '.replit')], '.md'),
  },
  {
    id: 'roo',
    displayName: 'Roo Code',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('roo', [join(getHomeDir(), '.roo')], '.md'),
  },
  {
    id: 'trae',
    displayName: 'Trae',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('trae', [join(getHomeDir(), '.trae')], '.md'),
  },
  {
    id: 'trae-cn',
    displayName: 'Trae CN',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('trae-cn', [join(getHomeDir(), '.trae-cn')], '.md'),
  },
  {
    id: 'windsurf',
    displayName: 'Windsurf / Devin Desktop',
    group: 'other',
    implemented: true,
    defaultEnabled: true,
    createAdapter: () => windsurfAdapter,
  },
  {
    id: 'zencoder',
    displayName: 'Zencoder',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('zencoder', [join(getHomeDir(), '.zencoder')], '.json'),
  },
  {
    id: 'neovate',
    displayName: 'Neovate',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('neovate', [join(getHomeDir(), '.neovate')], '.json'),
  },
  {
    id: 'pochi',
    displayName: 'Pochi',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('pochi', [join(getHomeDir(), '.pochi')], '.json'),
  },
  {
    id: 'adal',
    displayName: 'AdaL',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () => createStubAdapter('adal', [join(getHomeDir(), '.adal')], '.json'),
  },
  {
    id: 'aider',
    displayName: 'Aider',
    group: 'other',
    implemented: false,
    defaultEnabled: false,
    createAdapter: () =>
      createStubAdapter('aider', [join(getHomeDir(), '.aider')], '.aider.chat.history.md'),
  },
];

export function getAdapterCatalog(): AdapterCatalogEntry[] {
  return CATALOG.map((entry) => ({ ...entry }));
}

export function getCatalogAdapterIds(): AdapterId[] {
  return CATALOG.map((entry) => entry.id);
}

export function getCatalogDefaultAdapterIds(): AdapterId[] {
  return CATALOG.filter((entry) => entry.implemented && entry.defaultEnabled).map(
    (entry) => entry.id,
  );
}

export function isAdapterId(value: string): value is AdapterId {
  return CATALOG.some((entry) => entry.id === value);
}

const LEGACY_TO_ADAPTER_ID = new Map<string, AdapterId>([
  ...Object.entries(ADAPTER_AGENT_ALIASES).map(
    ([adapterId, agent]) => [agent, adapterId as AdapterId] as const,
  ),
  // Renamed from command-code → commandcode; keep old config/plan ids working.
  ['command-code', 'commandcode'],
]);

export function resolveAdapterId(value: string): AdapterId | undefined {
  if (isAdapterId(value)) return value;
  return LEGACY_TO_ADAPTER_ID.get(value);
}
