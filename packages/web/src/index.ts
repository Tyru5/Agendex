export { AgentFilter } from './client/components/AgentFilter.tsx';
export { AgentIcon } from './client/components/AgentIcon.tsx';
export { EmptyStateView } from './client/components/EmptyStateView.tsx';
export { LandingPage } from './client/components/LandingPage.tsx';
export type { LandingPageProps } from './client/components/LandingPage.tsx';
export { useLandingContext } from './client/components/landing/LandingContext.tsx';
export { MarkdownCodeBlock } from './client/components/MarkdownCodeBlock.tsx';
export { GitHubIcon, GoogleIcon } from './client/components/OAuthIcons.tsx';
export { OfflineView } from './client/components/OfflineView.tsx';
export { PlanCreator } from './client/components/PlanCreator.tsx';
export { PlanEditor } from './client/components/PlanEditor.tsx';
export { PlanList } from './client/components/PlanList.tsx';
export { PlanOutline } from './client/components/PlanOutline.tsx';
export { PlanUploader } from './client/components/PlanUploader.tsx';
export { PlanViewer } from './client/components/PlanViewer.tsx';
export { SearchBar } from './client/components/SearchBar.tsx';
export { SidebarFilters } from './client/components/SidebarFilters.tsx';
export { Skeleton, SkeletonBlock, SkeletonLine } from './client/components/Skeleton.tsx';
export type {
  ResolvedTheme,
  ThemeContextValue,
  ThemePreference,
} from './client/components/ThemeProvider.tsx';
export { ThemeContext, ThemeProvider } from './client/components/ThemeProvider.tsx';
export { ThemeToggle } from './client/components/ThemeToggle.tsx';
export { ExitFullscreenIcon, FullscreenIcon } from './client/components/FullscreenIcons.tsx';
export { AgentSelect } from './client/components/AgentSelect.tsx';
export { Sidebar } from './client/components/Sidebar.tsx';
export { TechDependencyChart } from './client/components/TechDependencyChart.tsx';
export { Topbar } from './client/components/Topbar.tsx';
export { WipMarquee } from './client/components/WipMarquee.tsx';

export type { BackendStatus } from './client/hooks/useBackendStatus.ts';
export { useBackendStatus } from './client/hooks/useBackendStatus.ts';
export { useAgents, usePlans } from './client/hooks/usePlans.ts';
export { seedSeen, useSeenPlans } from './client/hooks/useSeenPlans.ts';
export { useSocketEvent } from './client/hooks/useSocket.ts';
export { useTheme } from './client/hooks/useTheme.ts';
export { useFullscreen } from './client/hooks/useFullscreen.ts';
export { useScrollSpy } from './client/hooks/useScrollSpy.ts';

export {
  AGENT_IDS,
  getAgentColor,
  getAgentGlyph,
  getAgentIcon,
  getAgentLabel,
} from './client/lib/agent-colors.ts';
export type { AgentStats, Plan, PlansResponse } from './client/lib/api.ts';
export {
  api,
  clearToken,
  hasToken,
  setToken,
} from './client/lib/api.ts';
export type { OutlineEntry } from './client/lib/extract-headings.ts';
export { buildPlanOutline } from './client/lib/extract-headings.ts';
export { looksLikeMarkdown, normalizePlanMarkdown } from './client/lib/plan-markdown.ts';
export { filterPlans } from './client/lib/plan-search.ts';
export { sanitizeSchema } from './client/lib/sanitize-schema.ts';
export { SIDEBAR_EXPANDED_WIDTH } from './client/lib/constants.ts';
export type { DetectedTech, TechCategory } from './client/lib/tech-extract.ts';
export { extractTechnologies } from './client/lib/tech-extract.ts';
export type { TechEdge, TechGraph, TechNode, TechNodeData } from './client/lib/tech-graph.ts';
export { buildAdjacencyMap, buildTechGraph, CATEGORY_COLORS } from './client/lib/tech-graph.ts';
export { startViewTransition } from './client/lib/view-transition.ts';

export { default as dinoVitaIdleStrip } from './client/components/landing/dino-vita-idle-strip.png';
export { default as dinoShadow } from './client/components/landing/dino-shadow.png';
