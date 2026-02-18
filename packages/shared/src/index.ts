export type { Plan, AgentAdapter } from './types.ts';
export { hashPath } from './hash.ts';

export type { AdapterId, AdapterCatalogEntry, AdapterGroup } from './adapters/catalog.ts';
export { ADAPTER_AGENT_ALIASES } from './adapters/catalog.ts';
export {
  resolveAdapters,
  setActiveAdapters,
  getActiveAdapters,
  getCatalog,
  getDefaultAdapterIds,
  sanitizeEnabledAdapterIds,
} from './adapters/registry.ts';

export type { AgendexConfig, InitConfigOptions } from './config.ts';
export {
  loadConfig,
  saveConfig,
  loadOrCreateToken,
  loadOrInitConfig,
  getConfigPath,
} from './config.ts';

export {
  scan,
  getAll,
  getById,
  update,
  create,
  getAgentStats,
  rescanFile,
  setOnPlansChanged,
} from './services/plan-service.ts';

export { startWatching } from './services/watcher.ts';

export { canPromptForAdapters, promptForAdapterSelection } from './setup/adapter-selection.ts';
