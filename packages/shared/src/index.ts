export type { AdapterCatalogEntry, AdapterGroup, AdapterId } from './adapters/catalog.ts';
export { ADAPTER_AGENT_ALIASES } from './adapters/catalog.ts';
export {
  getActiveAdapters,
  getCatalog,
  getDefaultAdapterIds,
  resolveAdapters,
  sanitizeEnabledAdapterIds,
  setActiveAdapters,
} from './adapters/registry.ts';
export type { AgendexConfig, InitConfigOptions } from './config.ts';
export {
  getConfigPath,
  loadConfig,
  loadOrCreateToken,
  loadOrInitConfig,
  saveConfig,
} from './config.ts';
export { hashPath } from './hash.ts';
export type { DiscoveredPlanDir } from './services/plan-service.ts';
export {
  create,
  discoverProjectPlanDirs,
  getAgentStats,
  getAll,
  getById,
  rescanFile,
  scan,
  setOnPlansChanged,
  update,
} from './services/plan-service.ts';
export { startWatching } from './services/watcher.ts';
export { canPromptForAdapters, promptForAdapterSelection } from './setup/adapter-selection.ts';
export type { AgentAdapter, Plan } from './types.ts';
