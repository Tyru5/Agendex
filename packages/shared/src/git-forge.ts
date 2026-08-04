/**
 * Pure git-forge helpers shared between the CLI (sync-time enrichment), the
 * Convex backend (plan link normalization), and the EE client (chip URLs).
 *
 * This module MUST stay free of Node built-ins so it can run in the default
 * Convex runtime and the browser. Node-dependent git helpers live in `git.ts`.
 */

export type PlanGitLinkType = 'branch' | 'commit' | 'pr';

export interface GitRepoInfo {
  host: string;
  /** Owner path; may contain nested groups on GitLab (e.g. `group/subgroup`). */
  owner: string;
  name: string;
  /** https URL of the repo home page when derivable for the host. */
  webUrl?: string;
}

/** Git context captured on the syncing machine and stored at `plan.metadata.git`. */
export interface PlanGitContext {
  branch?: string;
  commit?: string;
  remoteUrl?: string;
  repo?: GitRepoInfo;
}

export type ForgeKind = 'github' | 'gitlab' | 'bitbucket';

export interface NormalizedPlanGitLink {
  type: PlanGitLinkType;
  value: string;
  url?: string;
}

export type PlanGitLinkNormalization =
  | { ok: true; link: NormalizedPlanGitLink }
  | { ok: false; error: string };

const MAX_LINK_INPUT_LENGTH = 512;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;
const PR_NUMBER_PATTERN = /^#?(\d{1,10})$/;

export function forgeKind(host: string): ForgeKind | null {
  const normalized = host.toLowerCase();
  if (normalized === 'github.com' || normalized.startsWith('github.')) return 'github';
  if (normalized.includes('gitlab')) return 'gitlab';
  if (normalized.includes('bitbucket')) return 'bitbucket';
  return null;
}

function stripGitSuffix(path: string): string {
  return path.replace(/\.git$/i, '').replace(/\/+$/, '');
}

function splitRepoPath(path: string): { owner: string; name: string } | null {
  const segments = stripGitSuffix(path)
    .split('/')
    .filter((segment) => segment.length > 0);
  if (segments.length < 2) return null;
  const name = segments[segments.length - 1];
  if (!name) return null;
  return { owner: segments.slice(0, -1).join('/'), name };
}

function repoInfo(
  host: string,
  path: string,
  options: { httpRemote: boolean },
): GitRepoInfo | null {
  const normalizedHost = host.toLowerCase();
  const parts = splitRepoPath(path);
  if (!normalizedHost || !parts) return null;

  // Only derive a browsable web URL when the remote was already http(s) or the
  // host is a recognized forge; ssh aliases for unknown hosts may not serve web UIs.
  const webUrl =
    options.httpRemote || forgeKind(normalizedHost)
      ? `https://${normalizedHost}/${parts.owner}/${parts.name}`
      : undefined;

  return {
    host: normalizedHost,
    owner: parts.owner,
    name: parts.name,
    ...(webUrl && { webUrl }),
  };
}

/**
 * Parse a git remote URL into repo info. Supports:
 * - scp-like ssh: `git@github.com:owner/repo.git`
 * - ssh URLs: `ssh://git@host[:port]/owner/repo.git`
 * - http(s) URLs: `https://host/owner/repo.git` (credentials stripped)
 * - git protocol: `git://host/owner/repo.git`
 */
export function parseRemoteUrl(url: string): GitRepoInfo | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  const schemeMatch = trimmed.match(
    /^(https?|ssh|git):\/\/(?:([^/@]+)@)?([^/:]+)(?::\d+)?\/(.+)$/i,
  );
  if (schemeMatch) {
    const scheme = schemeMatch[1]?.toLowerCase();
    const host = schemeMatch[3];
    const path = schemeMatch[4];
    if (!host || !path) return null;
    return repoInfo(host, path, { httpRemote: scheme === 'http' || scheme === 'https' });
  }

  const scpMatch = trimmed.match(/^(?:[\w.-]+@)?([\w.-]+):(?!\/)(.+)$/);
  if (scpMatch) {
    const host = scpMatch[1];
    const path = scpMatch[2];
    // Reject things that look like Windows drive paths (`c:\...`).
    if (!host || !path || /^[a-z]$/i.test(host)) return null;
    return repoInfo(host, path, { httpRemote: false });
  }

  return null;
}

/**
 * Strip userinfo (usernames, embedded access tokens) from a remote URL so it
 * is safe to persist and sync. `https://user:token@host/...` → `https://host/...`.
 */
export function sanitizeRemoteUrl(url: string): string {
  const trimmed = url.trim();
  const match = trimmed.match(/^((?:https?|ssh|git):\/\/)[^/@]+@(.*)$/i);
  if (match?.[1] && match[2]) return `${match[1]}${match[2]}`;
  return trimmed;
}

function encodeBranchPath(branch: string): string {
  return branch.split('/').map(encodeURIComponent).join('/');
}

function encodeSourcePath(path: string): string | undefined {
  const segments = path.split('/');
  if (
    segments.length === 0 ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    return undefined;
  }
  return segments.map(encodeURIComponent).join('/');
}

export function branchUrl(repo: GitRepoInfo | undefined, branch: string): string | undefined {
  if (!repo?.webUrl) return undefined;
  switch (forgeKind(repo.host)) {
    case 'github':
      return `${repo.webUrl}/tree/${encodeBranchPath(branch)}`;
    case 'gitlab':
      return `${repo.webUrl}/-/tree/${encodeBranchPath(branch)}`;
    case 'bitbucket':
      return `${repo.webUrl}/branch/${encodeBranchPath(branch)}`;
    default:
      return undefined;
  }
}

export function commitUrl(repo: GitRepoInfo | undefined, sha: string): string | undefined {
  if (!repo?.webUrl) return undefined;
  switch (forgeKind(repo.host)) {
    case 'github':
      return `${repo.webUrl}/commit/${sha}`;
    case 'gitlab':
      return `${repo.webUrl}/-/commit/${sha}`;
    case 'bitbucket':
      return `${repo.webUrl}/commits/${sha}`;
    default:
      return undefined;
  }
}

export function prUrl(repo: GitRepoInfo | undefined, prNumber: number): string | undefined {
  if (!repo?.webUrl) return undefined;
  switch (forgeKind(repo.host)) {
    case 'github':
      return `${repo.webUrl}/pull/${prNumber}`;
    case 'gitlab':
      return `${repo.webUrl}/-/merge_requests/${prNumber}`;
    case 'bitbucket':
      return `${repo.webUrl}/pull-requests/${prNumber}`;
    default:
      return undefined;
  }
}

/** Build a forge URL for a repo-relative source file, optionally at a line range. */
export function sourceFileUrl(
  repo: GitRepoInfo | undefined,
  ref: string,
  path: string,
  line?: number,
  lineEnd?: number,
): string | undefined {
  if (!repo?.webUrl || !ref.trim()) return undefined;
  const encodedPath = encodeSourcePath(path);
  if (!encodedPath) return undefined;

  const encodedRef = encodeBranchPath(ref);
  const startLine = line && line > 0 ? Math.floor(line) : undefined;
  const endLine = lineEnd && lineEnd > 0 ? Math.floor(lineEnd) : undefined;

  switch (forgeKind(repo.host)) {
    case 'github': {
      const anchor = startLine
        ? `#L${startLine}${endLine && endLine !== startLine ? `-L${endLine}` : ''}`
        : '';
      return `${repo.webUrl}/blob/${encodedRef}/${encodedPath}${anchor}`;
    }
    case 'gitlab': {
      const anchor = startLine
        ? `#L${startLine}${endLine && endLine !== startLine ? `-${endLine}` : ''}`
        : '';
      return `${repo.webUrl}/-/blob/${encodedRef}/${encodedPath}${anchor}`;
    }
    case 'bitbucket': {
      const anchor = startLine
        ? `#lines-${startLine}${endLine && endLine !== startLine ? `:${endLine}` : ''}`
        : '';
      return `${repo.webUrl}/src/${encodedRef}/${encodedPath}${anchor}`;
    }
    default:
      return undefined;
  }
}

export function shortCommit(sha: string): string {
  return sha.slice(0, 7);
}

/**
 * Allowlist http(s) URLs for use in chip `href`s and stored link fields.
 * Rejects `javascript:`, `data:`, and other non-http schemes that would
 * otherwise execute when a share-link viewer clicks a chip. Optionally
 * requires the URL host to match an expected forge host (blocks open
 * redirects disguised as a repo chip).
 */
export function safeHttpUrl(
  url: string | undefined,
  options?: { expectedHost?: string },
): string | undefined {
  if (!url) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
  if (
    options?.expectedHost &&
    parsed.hostname.toLowerCase() !== options.expectedHost.toLowerCase()
  ) {
    return undefined;
  }
  // Strip embedded credentials so they never appear in rendered hrefs.
  if (parsed.username || parsed.password) {
    parsed.username = '';
    parsed.password = '';
  }
  return parsed.href;
}

function rebuildRepoWebUrl(host: string, owner: string, name: string): string | undefined {
  // Only invent a browsable URL for recognized forges; unknown ssh hosts may
  // not serve a web UI. Matches the heuristic used by `parseRemoteUrl`.
  if (!forgeKind(host)) return undefined;
  return `https://${host}/${owner}/${name}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

/**
 * Read the git context stored at `metadata.git` (written by CLI sync
 * enrichment), falling back to legacy adapter-level `metadata.branch` /
 * `metadata.commit` fields (e.g. the Grok adapter).
 *
 * `repo.webUrl` is re-validated as http(s) (and host-matched) so crafted
 * client-synced metadata cannot put `javascript:` / `data:` into chip hrefs.
 */
export function extractPlanGitContext(metadata: unknown): PlanGitContext | null {
  if (!isRecord(metadata)) return null;

  const context: PlanGitContext = {};
  const git = isRecord(metadata.git) ? metadata.git : undefined;

  if (git) {
    const branch = stringField(git, 'branch');
    const commit = stringField(git, 'commit');
    const remoteUrl = stringField(git, 'remoteUrl');
    if (branch) context.branch = branch;
    if (commit) context.commit = commit;
    if (remoteUrl) context.remoteUrl = remoteUrl;

    if (isRecord(git.repo)) {
      const host = stringField(git.repo, 'host');
      const owner = stringField(git.repo, 'owner');
      const name = stringField(git.repo, 'name');
      if (host && owner && name) {
        const webUrl =
          safeHttpUrl(stringField(git.repo, 'webUrl'), { expectedHost: host }) ??
          rebuildRepoWebUrl(host, owner, name);
        context.repo = { host, owner, name, ...(webUrl && { webUrl }) };
      }
    }
    if (!context.repo && context.remoteUrl) {
      const parsed = parseRemoteUrl(context.remoteUrl);
      if (parsed) context.repo = parsed;
    }
  }

  if (!context.branch) {
    const branch = stringField(metadata, 'branch');
    if (branch) context.branch = branch;
  }
  if (!context.commit) {
    const commit = stringField(metadata, 'commit');
    if (commit) context.commit = commit;
  }

  return Object.keys(context).length > 0 ? context : null;
}

const PR_URL_PATTERNS = [/\/pull\/(\d+)/, /\/merge_requests\/(\d+)/, /\/pull-requests\/(\d+)/];
const COMMIT_URL_PATTERN = /\/commits?\/([0-9a-f]{7,40})(?:$|[/?#])/i;
const BRANCH_URL_PATTERN = /\/(?:tree|branch)\/(.+?)(?:[?#]|$)/;

/**
 * Classify free-form user input (branch name, commit sha, PR number like
 * `#123`, or a forge URL) into a normalized plan git link. URLs from the
 * plan's own forge are preserved as-is; bare values get URLs resolved against
 * the provided repo when possible.
 */
export function normalizePlanGitLink(
  rawInput: string,
  repo?: GitRepoInfo,
): PlanGitLinkNormalization {
  const raw = rawInput.trim();
  if (!raw) return { ok: false, error: 'Enter a branch name, commit SHA, PR number, or URL' };
  if (raw.length > MAX_LINK_INPUT_LENGTH) {
    return { ok: false, error: `Link input must be under ${MAX_LINK_INPUT_LENGTH} characters` };
  }

  const prNumberMatch = raw.match(PR_NUMBER_PATTERN);
  if (prNumberMatch?.[1]) {
    const prNumber = Number.parseInt(prNumberMatch[1], 10);
    const url = prUrl(repo, prNumber);
    return { ok: true, link: { type: 'pr', value: `#${prNumber}`, ...(url && { url }) } };
  }

  if (/^https?:\/\//i.test(raw) || /^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    const safeUrl = safeHttpUrl(raw);
    if (!safeUrl) {
      return { ok: false, error: 'Only http(s) URLs are allowed' };
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(safeUrl);
    } catch {
      return { ok: false, error: 'Invalid URL' };
    }
    const pathname = parsedUrl.pathname;

    for (const pattern of PR_URL_PATTERNS) {
      const match = pathname.match(pattern);
      if (match?.[1]) {
        return { ok: true, link: { type: 'pr', value: `#${match[1]}`, url: safeUrl } };
      }
    }

    const commitMatch = pathname.match(COMMIT_URL_PATTERN);
    if (commitMatch?.[1]) {
      return {
        ok: true,
        link: { type: 'commit', value: commitMatch[1].toLowerCase(), url: safeUrl },
      };
    }

    const branchMatch = pathname.match(BRANCH_URL_PATTERN);
    if (branchMatch?.[1]) {
      let branch = branchMatch[1];
      try {
        branch = decodeURIComponent(branch);
      } catch {
        // keep the raw path segment when it is not valid percent-encoding
      }
      return { ok: true, link: { type: 'branch', value: branch, url: safeUrl } };
    }

    return {
      ok: false,
      error: 'URL not recognized as a PR, commit, or branch link',
    };
  }

  if (COMMIT_SHA_PATTERN.test(raw)) {
    const sha = raw.toLowerCase();
    const url = commitUrl(repo, sha);
    return { ok: true, link: { type: 'commit', value: sha, ...(url && { url }) } };
  }

  if (/\s/.test(raw)) {
    return { ok: false, error: 'Branch names cannot contain whitespace' };
  }

  const url = branchUrl(repo, raw);
  return { ok: true, link: { type: 'branch', value: raw, ...(url && { url }) } };
}

/** Resolve the display URL for a stored link against a repo (for links saved without one). */
export function planGitLinkUrl(
  link: { type: PlanGitLinkType; value: string; url?: string },
  repo?: GitRepoInfo,
): string | undefined {
  // Stored URLs are re-validated so older/crafted non-http(s) values never
  // reach chip hrefs; fall through to repo-derived builders when rejected.
  const stored = safeHttpUrl(link.url);
  if (stored) return stored;
  switch (link.type) {
    case 'branch':
      return branchUrl(repo, link.value);
    case 'commit':
      return commitUrl(repo, link.value);
    case 'pr': {
      const match = link.value.match(/^#?(\d+)$/);
      return match?.[1] ? prUrl(repo, Number.parseInt(match[1], 10)) : undefined;
    }
    default:
      return undefined;
  }
}
