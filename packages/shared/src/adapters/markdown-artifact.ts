import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { hashPath } from '../hash.ts';
import type { AgentAdapter, Plan } from '../types.ts';

type MaybePromise<T> = T | Promise<T>;

export interface MarkdownArtifactContext {
  filePath: string;
  content: string;
}

export interface MarkdownArtifactAdapterOptions {
  agent: string;
  getSearchPaths: () => string[];
  matches: (filePath: string) => boolean;
  writable?: boolean;
  title?: (context: MarkdownArtifactContext) => MaybePromise<string | undefined>;
  workspace?: (context: MarkdownArtifactContext) => MaybePromise<string | undefined>;
  metadata?: (
    context: MarkdownArtifactContext,
  ) => MaybePromise<Record<string, unknown> | undefined>;
}

export interface MarkdownBundleDocument {
  filenames: string[];
  heading: string;
}

export interface MarkdownBundleContext {
  bundleDir: string;
  sourcePaths: string[];
}

export interface MarkdownBundleAdapterOptions {
  agent: string;
  getSearchPaths: () => string[];
  matches: (filePath: string) => boolean;
  getBundleDir: (filePath: string) => string;
  documents: MarkdownBundleDocument[];
  title?: (context: MarkdownBundleContext) => MaybePromise<string | undefined>;
  workspace?: (context: MarkdownBundleContext) => MaybePromise<string | undefined>;
  metadata?: (context: MarkdownBundleContext) => MaybePromise<Record<string, unknown> | undefined>;
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.filter(Boolean)));
}

function revisionFor(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function humanizeFilename(filePath: string): string {
  const stem = basename(filePath).replace(/(?:\.plan)?\.md$/i, '');
  return stem
    .replace(/^\d{4}-\d{2}-\d{2}[-_]?/, '')
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function titleFromMarkdown(content: string, filePath: string): string {
  const heading = content.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/m)?.[1];
  return heading?.replace(/^Plan:\s*/i, '').trim() || humanizeFilename(filePath) || 'Plan';
}

export function createMarkdownArtifactAdapter(
  options: MarkdownArtifactAdapterOptions,
): AgentAdapter {
  const writable = options.writable ?? false;

  return {
    agent: options.agent,
    writable,

    getSearchPaths() {
      return uniquePaths(options.getSearchPaths());
    },

    getWatchPaths() {
      return uniquePaths(options.getSearchPaths());
    },

    matches(filePath: string) {
      return options.matches(filePath);
    },

    async parse(filePath: string): Promise<Plan[]> {
      if (!options.matches(filePath)) return [];

      try {
        const [content, stats] = await Promise.all([readFile(filePath, 'utf-8'), stat(filePath)]);
        const context = { filePath, content };
        const [customTitle, workspace, customMetadata] = await Promise.all([
          options.title?.(context),
          options.workspace?.(context),
          options.metadata?.(context),
        ]);

        return [
          {
            id: hashPath(filePath),
            agent: options.agent,
            title: customTitle || titleFromMarkdown(content, filePath),
            content,
            filePath,
            format: 'md',
            createdAt: stats.birthtime,
            updatedAt: stats.mtime,
            workspace,
            metadata: {
              source: 'markdown-artifact',
              sourcePaths: [filePath],
              revision: revisionFor(content),
              ...customMetadata,
            },
          },
        ];
      } catch {
        return [];
      }
    },

    async write(plan: Plan, newContent: string): Promise<boolean> {
      if (!writable) return false;
      try {
        await writeFile(plan.filePath, newContent, 'utf-8');
        return true;
      } catch {
        return false;
      }
    },
  };
}

export function createMarkdownBundleAdapter(options: MarkdownBundleAdapterOptions): AgentAdapter {
  return {
    agent: options.agent,
    writable: false,

    getSearchPaths() {
      return uniquePaths(options.getSearchPaths());
    },

    getWatchPaths() {
      return uniquePaths(options.getSearchPaths());
    },

    matches(filePath: string) {
      return options.matches(filePath);
    },

    async parse(filePath: string): Promise<Plan[]> {
      if (!options.matches(filePath)) return [];

      const bundleDir = options.getBundleDir(filePath);
      const loaded: Array<{
        heading: string;
        path: string;
        content: string;
        createdAt: Date;
        updatedAt: Date;
      }> = [];

      for (const document of options.documents) {
        let loadedDocument = false;
        for (const filename of document.filenames) {
          const path = join(bundleDir, filename);
          try {
            const [content, stats] = await Promise.all([readFile(path, 'utf-8'), stat(path)]);
            loaded.push({
              heading: document.heading,
              path,
              content: content.trim(),
              createdAt: stats.birthtime,
              updatedAt: stats.mtime,
            });
            loadedDocument = true;
            break;
          } catch {
            // Optional bundle members may not exist yet.
          }
        }
        if (!loadedDocument) continue;
      }

      if (loaded.length === 0) return [];

      const sourcePaths = loaded.map((document) => document.path);
      const context = { bundleDir, sourcePaths };
      const [customTitle, workspace, customMetadata] = await Promise.all([
        options.title?.(context),
        options.workspace?.(context),
        options.metadata?.(context),
      ]);
      const title = customTitle || humanizeFilename(`${bundleDir}.md`) || 'Plan';
      const content = [
        `# ${title}`,
        ...loaded.map((document) => `## ${document.heading}\n\n${document.content}`),
      ].join('\n\n');
      const createdAt = new Date(
        Math.min(...loaded.map((document) => document.createdAt.getTime())),
      );
      const updatedAt = new Date(
        Math.max(...loaded.map((document) => document.updatedAt.getTime())),
      );
      const primaryDocument =
        loaded.find((document) => basename(document.path).toLowerCase() === 'tasks.md') ??
        loaded[0];
      if (!primaryDocument) return [];

      return [
        {
          id: hashPath(bundleDir),
          agent: options.agent,
          title,
          content,
          filePath: primaryDocument.path,
          format: 'md',
          createdAt,
          updatedAt,
          workspace,
          metadata: {
            source: 'markdown-bundle',
            bundleDir,
            sourcePaths,
            revision: revisionFor(content),
            ...customMetadata,
          },
        },
      ];
    },

    async write(): Promise<boolean> {
      return false;
    },
  };
}
