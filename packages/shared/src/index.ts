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
  getConfigDir,
  getConfigPath,
  isDevMode,
  loadConfig,
  loadOrCreateDeviceId,
  loadOrCreateToken,
  loadOrInitConfig,
  normalizeCustomPlanDirs,
  saveConfig,
  setDevMode,
} from './config.ts';
export {
  CLI_DAEMON_HEARTBEAT_INTERVAL_MS,
  CLI_DAEMON_STALE_AFTER_MS,
  CLI_DAEMON_STATUS_POLL_INTERVAL_MS,
} from './daemon-status.ts';
export { hashPath } from './hash.ts';
export type { DiscoveredPlanDir } from './services/plan-service.ts';
export {
  create,
  discoverProjectPlanDirs,
  getAgentStats,
  getAll,
  getById,
  getCustomPlanDirs,
  rescanFile,
  scan,
  setOnPlansChanged,
  update,
} from './services/plan-service.ts';
export { startWatching, stopWatching } from './services/watcher.ts';
export { canPromptForAdapters, promptForAdapterSelection } from './setup/adapter-selection.ts';
export type { AgentAdapter, Plan } from './types.ts';
export { ProFeature } from './types.ts';
