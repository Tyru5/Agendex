export enum ProFeature {
  CLOUD_SYNC = 'cloud_sync',
  SHARE_LINKS = 'share_links',
  COMMENTS = 'comments',
  PLAN_CREATION = 'plan_creation',
  TECH_CHARTS = 'tech_charts',
  UNSEEN_TRACKING = 'unseen_tracking',
  WORKSPACE_MEMBERS = 'workspace_members',
  PLAN_HISTORY = 'plan_history',
  TAGS_COLLECTIONS = 'tags_collections',
  PLANNOTATOR_INTEGRATION = 'plannotator_integration',
}

export interface PlannotatorPlanAnnotation {
  id?: string;
  source?: string;
  author?: string;
  type: 'DELETION' | 'REPLACEMENT' | 'INSERTION' | 'COMMENT' | 'GLOBAL_COMMENT';
  text?: string;
  originalText?: string;
  replacementText?: string;
  insertionText?: string;
  blockId?: string;
  startOffset?: number;
  endOffset?: number;
  createdAt?: number;
}

export interface PlannotatorReviewAnnotation {
  id?: string;
  source?: string;
  author?: string;
  type: 'comment' | 'suggestion' | 'concern';
  scope?: 'line' | 'file';
  filePath: string;
  lineStart: number;
  lineEnd: number;
  side?: 'old' | 'new';
  text?: string;
  suggestedCode?: string;
  originalCode?: string;
  severity?: 'important' | 'nit' | 'pre_existing' | string;
  reasoning?: string;
  createdAt?: number;
}

export type PlannotatorFeedbackAnnotation = PlannotatorPlanAnnotation | PlannotatorReviewAnnotation;

export type PlannotatorMode = 'plan' | 'review' | 'annotate' | 'archive';
export type PlannotatorStatus = 'approved' | 'denied' | 'pending' | 'unknown';

export interface PlannotatorMetadata {
  kind: 'snapshot' | 'live-session' | 'project-plan';
  mode?: PlannotatorMode;
  status?: PlannotatorStatus;
  origin?: string;
  url?: string;
  pid?: number;
  port?: number;
  project?: string;
  label?: string;
  reviewId?: string;
  sessionPath?: string;
  annotationsPath?: string;
  annotationCount?: number;
  sourcePlanPath?: string;
  startedAt?: string;
  writebackCapable?: boolean;
  lastWritebackStatus?: 'pending' | 'sent' | 'failed' | 'expired';
  lastWritebackAt?: number;
}

export interface PlannotatorWritebackPayload {
  feedback: string;
  revisedContent?: string;
  annotations?: PlannotatorFeedbackAnnotation[];
  source?: 'agendex-cloud' | 'agendex-local' | string;
  requestedAt?: number;
  writebackId?: string;
}

export interface Plan {
  id: string;
  agent: string;
  title: string;
  content: string;
  filePath: string;
  format: 'md' | 'json' | 'jsonl' | 'sqlite';
  createdAt: Date;
  updatedAt: Date;
  workspace?: string;
  metadata: Record<string, unknown>;
}

export interface AgentAdapter {
  agent: string;
  getSearchPaths(): string[];
  getWatchPaths(): string[];
  matches(filePath: string): boolean;
  parse(filePath: string): Promise<Plan[]>;
  write(plan: Plan, newContent: string): Promise<boolean>;
  requestChanges?(plan: Plan, payload: PlannotatorWritebackPayload): Promise<boolean>;
  readonly writable: boolean;
}
