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
  | 'omp'
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
  omp: 'omp',
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

const LEGACY_TO_ADAPTER_ID = new Map<string, AdapterId>([
  ...Object.entries(ADAPTER_AGENT_ALIASES).map(
    ([adapterId, agent]) => [agent, adapterId as AdapterId] as const,
  ),
  // Renamed from command-code → commandcode; keep old config/plan ids working.
  ['command-code', 'commandcode'],
]);

export function isAdapterId(value: string): value is AdapterId {
  return Object.prototype.hasOwnProperty.call(ADAPTER_AGENT_ALIASES, value);
}

export function resolveAdapterId(value: string): AdapterId | undefined {
  if (isAdapterId(value)) return value;
  return LEGACY_TO_ADAPTER_ID.get(value);
}

/** Adapter id, stored alias, and legacy labels that may appear on plan rows. */
export function storedAgentValuesForAdapter(adapterId: AdapterId): string[] {
  const values = new Set<string>([adapterId]);
  const alias = ADAPTER_AGENT_ALIASES[adapterId];
  if (alias) values.add(alias);
  for (const [legacy, id] of LEGACY_TO_ADAPTER_ID) {
    if (id === adapterId) values.add(legacy);
  }
  return [...values];
}
