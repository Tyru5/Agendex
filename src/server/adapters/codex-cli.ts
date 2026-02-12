import { homedir } from "os";
import { join, basename } from "path";
import { stat, readFile } from "fs/promises";
import { createHash } from "crypto";
import type { AgentAdapter, Plan } from "./types.ts";

const sessionsDir = join(homedir(), ".codex", "sessions");

function hashPath(filePath: string): string {
  return createHash("sha256").update(filePath).digest("hex").slice(0, 16);
}

interface CodexMessage {
  type?: string;
  session_meta?: { session_id: string; started_at: string };
  role?: string;
  content?: string | Array<{ type: string; text?: string }>;
}

function extractContent(lines: CodexMessage[]): string {
  const parts: string[] = [];
  for (const line of lines) {
    if (line.session_meta) continue;
    const role = line.role ?? line.type ?? "system";
    let text = "";
    if (typeof line.content === "string") {
      text = line.content;
    } else if (Array.isArray(line.content)) {
      text = line.content
        .filter((c) => c.type === "text" || c.type === "input_text")
        .map((c) => c.text ?? "")
        .join("\n");
    }
    if (!text.trim()) continue;
    parts.push(`**${role}**: ${text}`);
  }
  return parts.join("\n\n---\n\n");
}

function extractTitle(lines: CodexMessage[], filename: string): string {
  const firstUser = lines.find(
    (l) =>
      (l.role === "user" || l.type === "message") &&
      typeof l.content === "string" &&
      l.content.trim().length > 0
  );
  if (firstUser && typeof firstUser.content === "string") {
    return firstUser.content.slice(0, 80).trim();
  }
  return basename(filename, ".jsonl");
}

export const codexCliAdapter: AgentAdapter = {
  agent: "codex-cli",
  writable: false,

  getSearchPaths() {
    return [sessionsDir];
  },

  getWatchPaths() {
    return [sessionsDir];
  },

  matches(filePath: string) {
    return filePath.endsWith(".jsonl") && basename(filePath).startsWith("rollout-");
  },

  async parse(filePath: string): Promise<Plan[]> {
    try {
      const raw = await readFile(filePath, "utf-8");
      const lines: CodexMessage[] = raw
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l));

      if (lines.length === 0) return [];

      const stats = await stat(filePath);
      const meta = lines.find((l) => l.session_meta);
      const startedAt = meta?.session_meta?.started_at;

      return [
        {
          id: hashPath(filePath),
          agent: "codex-cli",
          title: extractTitle(lines, filePath),
          content: extractContent(lines),
          filePath,
          format: "jsonl",
          createdAt: startedAt ? new Date(startedAt) : stats.birthtime,
          updatedAt: stats.mtime,
          metadata: {
            sessionId: meta?.session_meta?.session_id,
          },
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
