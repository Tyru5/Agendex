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
  getHomeDir,
  isDevMode,
  loadConfig,
  loadOrCreateDeviceId,
  loadOrCreateToken,
  loadOrInitConfig,
  normalizeCustomPlanDirs,
  resolveCustomPlanDirPath,
  saveConfig,
  setDevMode,
} from './config.ts';
export {
  CLI_DAEMON_HEARTBEAT_INTERVAL_MS,
  CLI_DAEMON_STALE_AFTER_MS,
  CLI_DAEMON_STATUS_POLL_INTERVAL_MS,
} from './daemon-status.ts';
export { hashPath } from './hash.ts';
export type {
  CreatePlanAnnotationInput,
  PlanAnnotationKind,
  PlanAnnotationRecord,
  PlanAnnotationStatus,
  PlanTextAnchor,
} from './annotations.ts';
export {
  annotationToPlannotator,
  createPlanAnnotationRecord,
  createPlanTextAnchor,
  formatPlanAnnotationFeedback,
  toPlannotatorFeedbackAnnotations,
  validatePlanAnnotationInput,
} from './annotations.ts';
export {
  createPlanAnnotation,
  deletePlanAnnotation,
  listPlanAnnotations,
  updatePlanAnnotationStatus,
} from './services/annotation-store.ts';
export type { DiscoveredPlanDir } from './services/plan-service.ts';
export {
  create,
  discoverProjectPlanDirs,
  getAgentStats,
  getAll,
  getById,
  getCustomPlanDirs,
  getIndexableById,
  getIndexablePlans,
  requestChanges,
  rescanFile,
  scan,
  setOnPlansChanged,
  update,
} from './services/plan-service.ts';
export { isIndexablePlan, isLowValuePlan } from './services/plan-value.ts';
export { startWatching, stopWatching } from './services/watcher.ts';
export { canPromptForAdapters, promptForAdapterSelection } from './setup/adapter-selection.ts';
export type {
  AgentAdapter,
  Plan,
  PlannotatorFeedbackAnnotation,
  PlannotatorMetadata,
  PlannotatorMode,
  PlannotatorPlanAnnotation,
  PlannotatorReviewAnnotation,
  PlannotatorStatus,
  PlannotatorWritebackPayload,
} from './types.ts';
export { ProFeature } from './types.ts';
