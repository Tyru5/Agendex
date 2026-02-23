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
  readonly writable: boolean;
}
