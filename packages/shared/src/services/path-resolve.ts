/**
 * Jump-to-source resolve service: validate code-path mentions against a
 * plan workspace. Resolution is confined to the workspace root — absolute
 * paths outside it and `..` escapes report `missing`.
 */
import { existsSync, realpathSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export type PathExistsStatus = 'found' | 'ambiguous' | 'missing' | 'unavailable';

export type PathExistsResult =
  | { status: 'found'; resolved: string; relative: string }
  | { status: 'ambiguous'; matches: string[] }
  | { status: 'missing' }
  | { status: 'unavailable' };

export const PATH_EXISTS_BATCH_LIMIT = 500;
const MAX_AMBIGUOUS_MATCHES = 8;
const FILE_LIST_TTL_MS = 30_000;
const FILE_LIST_MAX_FILES = 50_000;
const FILE_LIST_MAX_DEPTH = 12;

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'target',
  'vendor',
  'coverage',
  '.venv',
  'venv',
  '__pycache__',
  '.cache',
  '.turbo',
]);

interface FileListEntry {
  expires: number;
  files: string[];
  promise?: Promise<string[]>;
}

const fileListCache = new Map<string, FileListEntry>();

export function clearPathResolveCache(): void {
  fileListCache.clear();
}

function safeRealpath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** True when `path` (after realpath) lives under `workspace` (after realpath). */
export function isWithinWorkspace(path: string, workspace: string): boolean {
  const realWorkspace = safeRealpath(workspace);
  const realPath = safeRealpath(path);
  if (!realWorkspace || !realPath) return false;
  return realPath === realWorkspace || realPath.startsWith(realWorkspace + sep);
}

async function walkWorkspace(workspace: string): Promise<string[]> {
  const files: string[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: workspace, depth: 0 }];

  while (queue.length > 0 && files.length < FILE_LIST_MAX_FILES) {
    const { dir, depth } = queue.shift()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (files.length >= FILE_LIST_MAX_FILES) break;
      const name = entry.name;
      if (entry.isDirectory()) {
        if (depth >= FILE_LIST_MAX_DEPTH) continue;
        if (IGNORED_DIRS.has(name)) continue;
        queue.push({ dir: join(dir, name), depth: depth + 1 });
      } else if (entry.isFile()) {
        files.push(relative(workspace, join(dir, name)));
      }
      // Symlinks skipped to avoid cycles and workspace escapes.
    }
  }

  return files;
}

/**
 * Workspace-relative file list with a short TTL. Warmed on first exists
 * request per workspace; never scans outside the workspace root.
 */
export async function warmCodeFileList(workspace: string): Promise<string[]> {
  const key = resolve(workspace);
  const cached = fileListCache.get(key);
  const now = Date.now();
  if (cached && cached.expires > now) {
    return cached.promise ? cached.promise : cached.files;
  }

  const promise = walkWorkspace(key).then((files) => {
    fileListCache.set(key, { expires: Date.now() + FILE_LIST_TTL_MS, files });
    return files;
  });
  fileListCache.set(key, { expires: now + FILE_LIST_TTL_MS, files: [], promise });
  return promise;
}

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

function foundResult(workspace: string, absolute: string): PathExistsResult {
  return {
    status: 'found',
    resolved: absolute,
    relative: toPosix(relative(workspace, absolute)),
  };
}

/** Return found only when the path still exists and realpath succeeds. */
function foundIfFile(realWorkspace: string, path: string): PathExistsResult | null {
  if (!isFile(path) || !isWithinWorkspace(path, realWorkspace)) return null;
  const real = safeRealpath(path);
  if (!real) return null;
  return foundResult(realWorkspace, real);
}

/** Confirm a cache-relative match still exists on disk inside the workspace. */
function foundFromRelativeMatch(
  realWorkspace: string,
  relativePath: string,
): PathExistsResult | null {
  return foundIfFile(realWorkspace, join(realWorkspace, relativePath));
}

function existingRelativeMatches(realWorkspace: string, matches: string[]): string[] {
  return matches.filter((relativePath) => {
    const absolute = join(realWorkspace, relativePath);
    return isFile(absolute) && isWithinWorkspace(absolute, realWorkspace);
  });
}

function resolveExistingMatches(realWorkspace: string, matches: string[]): PathExistsResult {
  const existing = existingRelativeMatches(realWorkspace, matches);
  if (existing.length === 1) {
    return foundFromRelativeMatch(realWorkspace, existing[0]!) ?? { status: 'missing' };
  }
  if (existing.length > 1) {
    return {
      status: 'ambiguous',
      matches: existing.slice(0, MAX_AMBIGUOUS_MATCHES).map(toPosix),
    };
  }
  return { status: 'missing' };
}

/**
 * Resolve a single cleaned path mention under the plan workspace.
 * Strategy order: absolute-in-workspace, plan-local ./ via baseDir,
 * exact relative, optional baseDir for non-./ relatives, case-insensitive
 * suffix match, bare basename match.
 */
export async function resolveCodeFile(
  input: string,
  workspace: string,
  baseDir?: string,
): Promise<PathExistsResult> {
  if (!input || input.length > 1024) return { status: 'missing' };
  if (!workspace || !existsSync(workspace)) return { status: 'unavailable' };

  const realWorkspace = safeRealpath(workspace);
  if (!realWorkspace) return { status: 'unavailable' };

  // 1. Absolute path: must exist and stay inside the workspace.
  if (isAbsolute(input)) {
    return foundIfFile(realWorkspace, input) ?? { status: 'missing' };
  }

  const isPlanLocal = input.startsWith('./');

  // 2. Plan-local ./… paths resolve against the plan directory only. Without a
  // usable baseDir we cannot honor ./ semantics, so do not fall through to
  // workspace-root / fuzzy matches that could open a different same-named file.
  if (isPlanLocal) {
    if (baseDir && isWithinWorkspace(baseDir, realWorkspace)) {
      return foundIfFile(realWorkspace, resolve(baseDir, input)) ?? { status: 'missing' };
    }
    return { status: 'missing' };
  }

  // 3. Exact relative join under the workspace.
  const exactHit = foundIfFile(realWorkspace, resolve(realWorkspace, input));
  if (exactHit) return exactHit;

  // 4. Relative to the plan file's own directory (non-./ siblings).
  if (baseDir && isWithinWorkspace(baseDir, realWorkspace)) {
    const fromBase = foundIfFile(realWorkspace, resolve(baseDir, input));
    if (fromBase) return fromBase;
  }

  // `..` escapes beyond the workspace never fall through to fuzzy matching.
  const normalized = input.replace(/^\.\//, '');
  if (normalized.startsWith('..')) return { status: 'missing' };

  const files = await warmCodeFileList(realWorkspace);
  const lowerInput = normalized.toLowerCase();

  // 5. Case-insensitive suffix match on the warmed file list.
  if (lowerInput.includes('/')) {
    const matches = files.filter((file) => {
      const lower = toPosix(file).toLowerCase();
      return lower === lowerInput || lower.endsWith('/' + lowerInput);
    });
    return resolveExistingMatches(realWorkspace, matches);
  }

  // 6. Bare basename match.
  const matches = files.filter((file) => {
    const posix = toPosix(file);
    const base = posix.slice(posix.lastIndexOf('/') + 1);
    return base.toLowerCase() === lowerInput;
  });
  return resolveExistingMatches(realWorkspace, matches);
}

/** Batch exists check keyed by the input path strings. */
export async function resolveCodeFileBatch(
  paths: readonly string[],
  workspace: string | undefined,
  baseDir?: string,
): Promise<Record<string, PathExistsResult>> {
  const unique = [...new Set(paths)].slice(0, PATH_EXISTS_BATCH_LIMIT);
  const results: Record<string, PathExistsResult> = {};

  if (!workspace || !existsSync(workspace)) {
    for (const path of unique) results[path] = { status: 'unavailable' };
    return results;
  }

  await Promise.all(
    unique.map(async (path) => {
      results[path] = await resolveCodeFile(path, workspace, baseDir);
    }),
  );
  return results;
}
