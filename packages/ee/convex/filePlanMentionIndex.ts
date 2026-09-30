import { extractCandidateCodePaths, parseCodePath } from '@agendex/shared/plan-paths';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import {
  betterDuplicateWinner,
  duplicateKey,
  hasLowValueMetadata,
  isVisiblePlan,
} from './planVisibility';

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

/** Bounded read of one duplicate group; real groups are a handful of re-synced copies. */
const MAX_DUPLICATE_GROUP = 32;

type MentionCtx = Pick<MutationCtx, 'db'>;

/**
 * Plan lists show one winner per duplicate sync identity, so only that winner's
 * mentions are visible: counts and lookups then agree with the rendered list.
 */
async function reconcileDuplicateGroup(
  ctx: MentionCtx,
  ownerId: string,
  key: string,
  excludePlanId?: Id<'plans'>,
): Promise<void> {
  const members = (
    await ctx.db
      .query('plans')
      .withIndex('by_owner_and_fileMentionDuplicateKey', (q) =>
        q.eq('ownerId', ownerId).eq('fileMentionDuplicateKey', key),
      )
      .take(MAX_DUPLICATE_GROUP)
  ).filter((plan) => plan._id !== excludePlanId);
  // Same eligibility as the list: persisted low-value plans never win.
  let winner: Doc<'plans'> | undefined;
  for (const plan of members) {
    if (hasLowValueMetadata(plan.metadata)) continue;
    winner = winner ? betterDuplicateWinner(winner, plan) : plan;
  }
  for (const plan of members) {
    await setMentionVisibility(ctx, plan._id, plan._id === winner?._id && isVisiblePlan(plan));
  }
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
  const plan = await ctx.db.get(planId);
  if (!plan) return;
  const old = await ctx.db
    .query('filePlanMentions')
    .withIndex('by_plan', (q) => q.eq('planId', planId))
    .take(MAX_FILE_MENTIONS);
  for (const row of old) await ctx.db.delete(row._id);
  const { paths, truncated } = extractCloudFileMentions(plan);
  const workspace = normalizeMentionWorkspace(plan.workspace);
  const visible = isVisiblePlan(plan);
  for (const path of paths)
    await ctx.db.insert('filePlanMentions', {
      ownerId: plan.ownerId,
      planId,
      path,
      workspace,
      visible,
    });
  const previousKey = plan.fileMentionDuplicateKey;
  const key = duplicateKey(plan);
  await ctx.db.patch(planId, {
    fileMentionIndexVersion: FILE_MENTION_INDEX_VERSION,
    fileMentionIndexTruncated: truncated,
    fileMentionDuplicateKey: key,
  });
  if (previousKey && previousKey !== key) {
    await reconcileDuplicateGroup(ctx, plan.ownerId, previousKey);
  }
  if (key) await reconcileDuplicateGroup(ctx, plan.ownerId, key);
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
  const previousKey = plan.fileMentionDuplicateKey;
  const key = duplicateKey(plan);
  if (previousKey !== key) await ctx.db.patch(planId, { fileMentionDuplicateKey: key });
  if (previousKey && previousKey !== key) {
    await reconcileDuplicateGroup(ctx, plan.ownerId, previousKey);
  }
  if (key) await reconcileDuplicateGroup(ctx, plan.ownerId, key);
  else await setMentionVisibility(ctx, planId, isVisiblePlan(plan));
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
