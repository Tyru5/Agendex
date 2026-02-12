export interface Plan {
  id: string;
  agent: string;
  title: string;
  content: string;
  filePath: string;
  format: "md" | "json" | "jsonl" | "sqlite";
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
