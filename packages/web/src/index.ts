export { AgentFilter } from './client/components/AgentFilter.tsx';
export {
  AgentAvatarProvider,
  useAgentAvatarMap,
  useAgentAvatarUrl,
} from './client/components/AgentAvatarContext.tsx';
export { AgentIcon } from './client/components/AgentIcon.tsx';
export { AgentSelect } from './client/components/AgentSelect.tsx';
export type { ChangelogPageProps } from './client/components/ChangelogPage.tsx';
export { ChangelogPage } from './client/components/ChangelogPage.tsx';
export type { DocsPageProps } from './client/components/DocsPage.tsx';
export { DocsPage } from './client/components/DocsPage.tsx';
export type { DownloadPageProps } from './client/components/DownloadPage.tsx';
export { DownloadPage } from './client/components/DownloadPage.tsx';
export type { ToolsUsedPageProps } from './client/components/ToolsUsedPage.tsx';
export { ToolsUsedPage } from './client/components/ToolsUsedPage.tsx';
export { EmptyStateView } from './client/components/EmptyStateView.tsx';
export { ExitFullscreenIcon, FullscreenIcon } from './client/components/FullscreenIcons.tsx';
export type { LandingPageProps } from './client/components/LandingPage.tsx';
export { LandingPage } from './client/components/LandingPage.tsx';
export { default as dinoShadow } from './client/components/landing/dino-shadow.png';
export { default as dinoVitaIdleStrip } from './client/components/landing/dino-vita-idle-strip.png';
export { useLandingContext } from './client/components/landing/LandingContext.tsx';
export { MarkdownCodeBlock } from './client/components/MarkdownCodeBlock.tsx';
export {
  planMarkdownComponents,
  planMarkdownRehypePlugins,
  planMarkdownRemarkPlugins,
} from './client/components/markdownRenderConfig.tsx';
export { GitHubIcon, GoogleIcon } from './client/components/OAuthIcons.tsx';
export { OfflineView } from './client/components/OfflineView.tsx';
export { PlanCreator } from './client/components/PlanCreator.tsx';
export { PlanEditor } from './client/components/PlanEditor.tsx';
export { FolderTree, MoveToFolderMenu } from './client/components/FolderTree.tsx';
export { PlanList } from './client/components/PlanList.tsx';
export { PlanFilterMismatchBanner } from './client/components/PlanFilterMismatchBanner.tsx';
export { PlanOutline } from './client/components/PlanOutline.tsx';
export { PlanSourcesDialog } from './client/components/PlanSourcesDialog.tsx';
export {
  FOCUS_PLAN_SEARCH_EVENT,
  focusPlanSearchField,
  PlanSearchField,
} from './client/components/PlanSearchField.tsx';
export { PlanUploader } from './client/components/PlanUploader.tsx';
export type { PlanAnnotationCreateDraft } from './client/components/PlanViewer.tsx';
export { PlanActionButton, PlanViewer } from './client/components/PlanViewer.tsx';
export { SearchBar } from './client/components/SearchBar.tsx';
export { Sidebar } from './client/components/Sidebar.tsx';
export type { SidebarFiltersProps, SidebarSortBy } from './client/components/SidebarFilters.tsx';
export { SidebarFilters } from './client/components/SidebarFilters.tsx';
export { SidebarResizeHandle } from './client/components/SidebarResizeHandle.tsx';
export { Skeleton, SkeletonBlock, SkeletonLine } from './client/components/Skeleton.tsx';
export { TechDependencyChart } from './client/components/TechDependencyChart.tsx';
export type {
  ResolvedTheme,
  ThemeContextValue,
  ThemePreference,
} from './client/components/ThemeProvider.tsx';
export { ThemeContext, ThemeProvider } from './client/components/ThemeProvider.tsx';
export { ThemeToggle } from './client/components/ThemeToggle.tsx';
export { Topbar } from './client/components/Topbar.tsx';
export { WipMarquee } from './client/components/WipMarquee.tsx';

export type { BackendStatus } from './client/hooks/useBackendStatus.ts';
export { useBackendStatus } from './client/hooks/useBackendStatus.ts';
export { useCustomPlanSources } from './client/hooks/useCustomPlanSources.ts';
export { useFullscreen } from './client/hooks/useFullscreen.ts';
export { usePinnedPlans } from './client/hooks/usePinnedPlans.ts';
export { usePlanState } from './client/hooks/usePlanState.ts';
export { usePlanFolders } from './client/hooks/usePlanFolders.ts';
export { useAgents, usePlans } from './client/hooks/usePlans.ts';
export { useScrollSpy } from './client/hooks/useScrollSpy.ts';
export { seedSeen, useSeenPlans } from './client/hooks/useSeenPlans.ts';
export {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useSidebarWidth,
} from './client/hooks/useSidebarWidth.ts';
export { useSocketEvent } from './client/hooks/useSocket.ts';
export { useTheme } from './client/hooks/useTheme.ts';

export {
  AGENT_IDS,
  getAgentColor,
  getAgentGlyph,
  getAgentIcon,
  getAgentLabel,
} from './client/lib/agent-colors.ts';
export type {
  PlanAnnotationKind,
  PlanAnnotationRecord,
  PlanAnnotationStatus,
  PlanTextAnchor,
} from './client/lib/annotations.ts';
export { createPlanTextAnchor } from './client/lib/annotations.ts';
export type { AgentStats, Plan, PlanAnnotationApiRecord, PlansResponse } from './client/lib/api.ts';
export { api, clearToken, hasToken, setToken } from './client/lib/api.ts';
export { SIDEBAR_EXPANDED_WIDTH } from './client/lib/constants.ts';
export type { FolderState, PlanFolder, PlanFolderStore } from './client/lib/plan-folders.ts';
export { MAX_FOLDERS } from './client/lib/plan-folders.ts';
export type {
  PlanDateBucket,
  PlanFilterChip,
  PlanFilterChipKind,
  PlanFilterChipLabels,
  PlanFilterState,
  PlanTagMembership,
} from './client/lib/plan-filters.ts';
export {
  applyPlanFilters,
  deriveFilterChips,
  normalizeFilterValues,
  workspacesFromPlans,
} from './client/lib/plan-filters.ts';
export type { OutlineEntry } from './client/lib/extract-headings.ts';
export { buildPlanOutline } from './client/lib/extract-headings.ts';
export { looksLikeMarkdown, normalizePlanMarkdown } from './client/lib/plan-markdown.ts';
export { filterPlans } from './client/lib/plan-search.ts';
export type {
  LineageConfidence,
  LineageRelation,
  PlanLineage,
  RelatedPlanEntry,
} from './client/lib/plan-lineage.ts';
export {
  extractLineageKeys,
  getRelatedPlans,
  plansWithSessionSiblings,
} from './client/lib/plan-lineage.ts';
export type { PlanState, PlanStatePlan } from './client/lib/plan-state.ts';
export { sanitizeSchema } from './client/lib/sanitize-schema.ts';
export type { PlanSyncOrigin } from './client/lib/sync-origin.ts';
export { extractSyncOrigin, formatSyncOriginLabel } from './client/lib/sync-origin.ts';
export type { DetectedTech, TechCategory } from './client/lib/tech-extract.ts';
export { extractTechnologies } from './client/lib/tech-extract.ts';
export type { TechEdge, TechGraph, TechNode, TechNodeData } from './client/lib/tech-graph.ts';
export { buildAdjacencyMap, buildTechGraph, CATEGORY_COLORS } from './client/lib/tech-graph.ts';
export { startViewTransition } from './client/lib/view-transition.ts';
