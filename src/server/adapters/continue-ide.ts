import { homedir } from "os";
import { join } from "path";
import { stat, readFile } from "fs/promises";
import { createHash } from "crypto";
import type { AgentAdapter, Plan } from "./types.ts";

const continueDir = join(homedir(), ".continue", "sessions");

function hashPath(filePath: string): string {
  return createHash("sha256").update(filePath).digest("hex").slice(0, 16);
}

interface SessionIndex {
  sessionId: string;
  title: string;
  dateCreated: string;
  workspaceDirectory?: string;
}

interface SessionFile {
  history?: Array<{
    role: string;
    content: string;
  }>;
}

export const continueIdeAdapter: AgentAdapter = {
  agent: "continue-ide",
  writable: false,

  getSearchPaths() {
    return [continueDir];
  },

  getWatchPaths() {
    return [continueDir];
  },

  matches(filePath: string) {
    return filePath.endsWith(".json");
  },

  async parse(filePath: string): Promise<Plan[]> {
    try {
      const raw = await readFile(filePath, "utf-8");
      const session: SessionFile = JSON.parse(raw);
      if (!session.history || session.history.length === 0) return [];

      const stats = await stat(filePath);

      let title = "Continue Session";
      let workspace: string | undefined;

      const indexPath = join(continueDir, "sessions.json");
      try {
        const indexRaw = await readFile(indexPath, "utf-8");
        const sessions: SessionIndex[] = JSON.parse(indexRaw);
        const sessionId = filePath.split("/").pop()?.replace(".json", "");
        const meta = sessions.find((s) => s.sessionId === sessionId);
        if (meta) {
          title = meta.title || title;
          workspace = meta.workspaceDirectory;
        }
      } catch {
        // index not available
      }

      const content = (session.history ?? [])
        .map((m) => `**${m.role}**: ${m.content}`)
        .join("\n\n---\n\n");

      return [
        {
          id: hashPath(filePath),
          agent: "continue-ide",
          title,
          content,
          filePath,
          format: "json",
          createdAt: stats.birthtime,
          updatedAt: stats.mtime,
          workspace,
          metadata: {},
        },
      ];
    } catch {
      return [];
    }
  },

  async write(): Promise<boolean> {
    return false;
  },
};
