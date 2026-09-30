import { extractCandidateCodePaths, parseCodePath } from '@agendex/shared/plan-paths';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { duplicateKey, hasLowValueMetadata, isVisiblePlan } from './planVisibility';

export const FILE_MENTION_INDEX_VERSION = 1;
export const MAX_FILE_MENTIONS = 512;

/** Normalize only text. Cloud never checks file existence or infers a git root. */
export function normalizeMentionWorkspace(value: string | undefined): string {
  const path = (value ?? '').trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
  return path.replace(/^([a-z]):/, (_, drive: string) => `${drive.toUpperCase()}:`);
}

function hasControlCharacters(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

export function normalizeFileMentionPath(
  raw: string,
  workspace?: string,
  baseDir?: string,
): string | null {
  let value = raw.trim().replace(/^([`"'])([\s\S]*)\1$/, '$2');
  if (
    !value ||
    value.length > 1024 ||
    /[*?<>|]/.test(value) ||
    hasControlCharacters(value) ||
    value.includes('://')
  )
    return null;
  value = value.replace(/\\/g, '/').replace(/(?::\d+(?:-\d+)?)?(?:#.*)?$/, '');
  const root = normalizeMentionWorkspace(workspace);
  const absolute = value.startsWith('/') || /^[A-Za-z]:\//.test(value);
  if (absolute) {
    value = normalizeMentionWorkspace(value);
    // A prefix must end at a separator: /repo-other is outside /repo.
    if (!root || !value.startsWith(`${root}/`)) return null;
    value = value.slice(root.length + 1);
  } else if (/^\.{1,2}\//.test(value) && baseDir) {
    const base = normalizeMentionWorkspace(baseDir);
    if (root && base.startsWith(`${root}/`)) value = `${base.slice(root.length + 1)}/${value}`;
  }
  const parts: string[] = [];
  for (const part of value.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.length ? parts.join('/') : null;
}

export function extractCloudFileMentions(plan: {
  content: string;
  workspace?: string;
  filePath?: string;
}): { paths: string[]; truncated: boolean } {
  const source = plan.content
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const absolutePattern = /(?:^|[\s(])((?:\/|[A-Za-z]:[\\/])[^\s`"'<>]+)(?=$|[\s)])/gm;
  const bare = source.replace(/([`"'])([^`"'\n]+)\1/g, '').replace(absolutePattern, ' ');
  const candidates = extractCandidateCodePaths(bare).map((candidate) => candidate.path);
  // Quoted/backtick paths can contain spaces; the shared parser rejects shell snippets.
  for (const match of source.matchAll(/([`"'])([^`"'\n]+)\1/g)) {
    const candidate = match[2];
    const parsed = candidate ? parseCodePath(candidate, { allowSpaces: true }) : null;
    if (parsed) candidates.push(parsed.path);
  }
  // Preserve the leading slash in bare absolute prose mentions; the shared
  // renderer's bare-token regex is intentionally conservative about it.
  for (const match of source.matchAll(absolutePattern)) {
    const candidate = match[1];
    const parsed = candidate ? parseCodePath(candidate) : null;
    if (parsed) candidates.push(parsed.path);
  }
  const workspace = normalizeMentionWorkspace(plan.workspace);
  // Never amplify an oversized uploaded workspace into hundreds of index rows.
  if (workspace.length > 1024) return { paths: [], truncated: true };
  const filePath = normalizeMentionWorkspace(plan.filePath);
  const baseDir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : undefined;
  const unique = new Set<string>();
  for (const candidate of candidates) {
    const path = normalizeFileMentionPath(candidate, workspace, baseDir);
    if (path) unique.add(path);
  }
  return {
    paths: [...unique].slice(0, MAX_FILE_MENTIONS),
    truncated: unique.size > MAX_FILE_MENTIONS,
  };
}

/** Members examined per reconcile: the winner plus any winner a write displaced. */
const DUPLICATE_RECONCILE_WINDOW = 32;

type MentionCtx = Pick<MutationCtx, 'db'>;

/**
 * Group key recorded on the plan. Persisted low-value plans are filtered from
 * the list before dedupe, so they never join a group: the newest member of a
 * group is then always the list's winner.
 */
function mentionDuplicateKey(plan: Doc<'plans'>): string | undefined {
  return hasLowValueMetadata(plan.metadata) ? undefined : duplicateKey(plan);
}

/**
 * Plan lists show one winner per duplicate sync identity, so only that winner's
 * mentions are visible: counts and lookups then agree with the rendered list.
 *
 * Members are read newest-first (the list's winner order), so the winner is the
 * first row and each call reads a bounded window. Every write that can change a
 * winner reconciles its group while the displaced winner is still at the top,
 * so older members beyond the window are already hidden; callers set the
 * refreshed plan's own visibility from the returned winner.
 */
async function reconcileDuplicateGroup(
  ctx: MentionCtx,
  ownerId: string,
  key: string,
  excludePlanId?: Id<'plans'>,
): Promise<Id<'plans'> | undefined> {
  const members = await ctx.db
    .query('plans')
    .withIndex('by_owner_and_fileMentionDuplicateKey_and_updatedAt', (q) =>
      q.eq('ownerId', ownerId).eq('fileMentionDuplicateKey', key),
    )
    .order('desc')
    .take(DUPLICATE_RECONCILE_WINDOW + 1);
  let winner: Id<'plans'> | undefined;
  for (const plan of members) {
    if (plan._id === excludePlanId) continue;
    winner ??= plan._id;
    await setMentionVisibility(ctx, plan._id, plan._id === winner && isVisiblePlan(plan));
  }
  return winner;
}

/** Re-pick winners for the plan's previous and current groups; returns its own visibility. */
async function reconcilePlanDuplicates(ctx: MentionCtx, plan: Doc<'plans'>): Promise<boolean> {
  const previousKey = plan.fileMentionDuplicateKey;
  const key = mentionDuplicateKey(plan);
  if (previousKey && previousKey !== key) {
    await reconcileDuplicateGroup(ctx, plan.ownerId, previousKey);
  }
  const winner = key ? await reconcileDuplicateGroup(ctx, plan.ownerId, key) : plan._id;
  return winner === plan._id && isVisiblePlan(plan);
}

async function setMentionVisibility(
  ctx: MentionCtx,
  planId: Id<'plans'>,
  visible: boolean,
): Promise<void> {
  // All of a plan's rows share one flag; only a changed plan pays for the rewrite.
  const first = await ctx.db
    .query('filePlanMentions')
    .withIndex('by_plan', (q) => q.eq('planId', planId))
    .first();
  if (!first || first.visible === visible) return;
  const rows = await ctx.db
    .query('filePlanMentions')
    .withIndex('by_plan', (q) => q.eq('planId', planId))
    .take(MAX_FILE_MENTIONS);
  for (const row of rows) await ctx.db.patch(row._id, { visible });
}

/** Called in the same transaction as every content/workspace/visibility write. */
export async function refreshFilePlanMentions(ctx: MentionCtx, planId: Id<'plans'>): Promise<void> {
  const current = await ctx.db.get(planId);
  if (!current) return;
  const old = await ctx.db
    .query('filePlanMentions')
    .withIndex('by_plan', (q) => q.eq('planId', planId))
    .take(MAX_FILE_MENTIONS);
  for (const row of old) await ctx.db.delete(row._id);
  const { paths, truncated } = extractCloudFileMentions(current);
  await ctx.db.patch(planId, {
    fileMentionIndexVersion: FILE_MENTION_INDEX_VERSION,
    fileMentionIndexTruncated: truncated,
    fileMentionDuplicateKey: mentionDuplicateKey(current),
  });
  // Rows are inserted after reconciling so their flag never depends on the window.
  const visible = await reconcilePlanDuplicates(ctx, current);
  const workspace = normalizeMentionWorkspace(current.workspace);
  for (const path of paths)
    await ctx.db.insert('filePlanMentions', {
      ownerId: current.ownerId,
      planId,
      path,
      workspace,
      visible,
    });
}

/**
 * Cheap follow-up for writes that change only duplicate identity or recency
 * (`syncIdentityKey`, `updatedAt`): re-pick group winners without re-extracting.
 */
export async function refreshFilePlanMentionDuplicates(
  ctx: MentionCtx,
  planId: Id<'plans'>,
): Promise<void> {
  const plan = await ctx.db.get(planId);
  if (!plan || plan.fileMentionIndexVersion === undefined) return;
  const key = mentionDuplicateKey(plan);
  if (plan.fileMentionDuplicateKey !== key) {
    await ctx.db.patch(planId, { fileMentionDuplicateKey: key });
  }
  await setMentionVisibility(ctx, planId, await reconcilePlanDuplicates(ctx, plan));
}

/** Called before plan deletion; at most 512 mention rows can exist per plan. */
export async function deleteFilePlanMentions(ctx: MentionCtx, planId: Id<'plans'>): Promise<void> {
  const rows = await ctx.db
    .query('filePlanMentions')
    .withIndex('by_plan', (q) => q.eq('planId', planId))
    .take(MAX_FILE_MENTIONS);
  for (const row of rows) await ctx.db.delete(row._id);
  // A deleted winner hands visibility to the next duplicate in its group.
  const plan = await ctx.db.get(planId);
  if (plan?.fileMentionDuplicateKey) {
    await reconcileDuplicateGroup(ctx, plan.ownerId, plan.fileMentionDuplicateKey, planId);
  }
}
