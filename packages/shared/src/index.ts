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
export type { AgendexConfig, InitConfigOptions, PlanDownloadRecord } from './config.ts';
export {
  CURRENT_CONFIG_VERSION,
  getConfigDir,
  getConfigPath,
  getHomeDir,
  isDevMode,
  loadConfig,
  loadOrCreateDeviceId,
  loadOrCreateToken,
  loadOrInitConfig,
  normalizeCustomPlanDirs,
  removeCustomPlanDir,
  isHomeRelativePath,
  resolveCustomPlanDirPath,
  saveConfig,
  setDevMode,
  updateConfig,
} from './config.ts';
export {
  CLI_DAEMON_HEARTBEAT_INTERVAL_MS,
  CLI_DAEMON_STALE_AFTER_MS,
  CLI_DAEMON_STATUS_POLL_INTERVAL_MS,
} from './daemon-status.ts';
export type {
  DesktopAuthCallback,
  DesktopAuthCallbackError,
  DesktopAuthCallbackInput,
  DesktopAuthCallbackParseResult,
  DesktopAuthStateExpectation,
  DesktopAuthStateValidationResult,
} from './desktop-auth-callback.ts';
export {
  createDesktopAuthCallbackUrl,
  DESKTOP_AUTH_CALLBACK_URL,
  parseDesktopAuthCallbackUrl,
  redactDesktopAuthCallbackUrl,
  validateDesktopAuthCallbackState,
} from './desktop-auth-callback.ts';
export { hashPath } from './hash.ts';
export type { OpenInApp, OpenInAppKind } from './open-in-apps.ts';
export { buildLaunchCommand, detectOpenInApps } from './open-in-apps.ts';
export type { PathExistsResult, PathExistsStatus } from './services/path-resolve.ts';
export {
  clearPathResolveCache,
  isWithinWorkspace,
  PATH_EXISTS_BATCH_LIMIT,
  resolveCodeFile,
  resolveCodeFileBatch,
  warmCodeFileList,
} from './services/path-resolve.ts';
export type {
  ForgeKind,
  GitRepoInfo,
  NormalizedPlanGitLink,
  PlanGitContext,
  PlanGitLinkNormalization,
  PlanGitLinkType,
} from './git-forge.ts';
export {
  branchUrl,
  commitUrl,
  extractPlanGitContext,
  forgeKind,
  normalizePlanGitLink,
  parseRemoteUrl,
  planGitLinkUrl,
  prUrl,
  safeHttpUrl,
  sanitizeRemoteUrl,
  shortCommit,
  sourceFileUrl,
} from './git-forge.ts';
export {
  captureGitContext,
  clearGitContextCache,
  findGitRoot,
  getPlanGitContext,
  resolvePlanRepoRoot,
} from './git.ts';
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
export type {
  PlanBrowseDedupeResult,
  PlanDownloadLookupCandidate,
  PlanDownloadLookupSelection,
  PlanDownloadTitlePageSelection,
} from './services/plan-download-lookup.ts';
export {
  canonicalPlanAgent,
  looksLikePlanAgent,
  dedupePlanDownloadCandidates,
  isExactPlanDownloadIdHit,
  looksLikePlanIdQuery,
  parsePlanDownloadQuery,
  planAgentLookupValues,
  planAgentsMatch,
  scorePlanTitleSimilarity,
  dedupePlanBrowseCandidates,
  planBrowseDedupeKeys,
  selectPlanDownloadMatches,
  selectPlanDownloadTitlePage,
  filterPlanBrowseMatches,
  suggestClosestPlans,
} from './services/plan-download-lookup.ts';
export type { PlanSyncIdentity, PlanSyncIdentityStrength } from './services/plan-sync-identity.ts';
export {
  computeContentHash,
  computePlanSyncIdentity,
  exactDuplicateKey,
  normalizeSyncPath,
  PLAN_SYNC_IDENTITY_VERSION,
  relativeSyncPath,
} from './services/plan-sync-identity.ts';
export { collectWatchPaths, startWatching, stopWatchingForShutdown } from './services/watcher.ts';
export type {
  AgentUsageTotals,
  ModelUsageTotals,
  UsageAgent,
  UsageBucket,
  UsageCloudEvent,
  UsageRecord,
  UsageSourceStatus,
  UsageSummary,
  UsageTokenTotals,
} from './usage/types.ts';
export { DEFAULT_USAGE_DAYS, getUsageSummaries, getUsageSummary } from './usage/service.ts';
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
  PlannotatorWritebackAction,
  PlannotatorWritebackPayload,
} from './types.ts';
export { ProFeature } from './types.ts';
