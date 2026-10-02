import { existsSync, realpathSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  CURRENT_CONFIG_VERSION,
  assessPlanValue,
  getAll,
  getById,
  isLowValuePlan,
  setPlanValueOverride,
  openPlanRead,
  clearPlanRead,
  getAgentStats,
  getFilePlanHistory,
  getFilePlanCounts,
  createPlanAnnotation,
  deletePlanAnnotation,
  detectOpenInApps,
  detectHandoffClis,
  getIndexableById,
  getIndexablePlans,
  getPlanReceipt,
  getPlanSessionCost,
  getPlanCheck,
  getPlanReceipts,
  isWithinWorkspace,
  listPlanAnnotations,
  loadConfig,
  normalizeCustomPlanDirs,
  PATH_EXISTS_BATCH_LIMIT,
  removeCustomPlanDir,
  resolveCodeFile,
  resolveCodeFileBatch,
  resolveCustomPlanDirPath,
  scan,
  searchPlans,
  startWatching,
  updateConfig,
  updatePlanAnnotationStatus,
  validatePlanAnnotationInput,
} from '@agendex/shared';
import { type PlanReceiptSummary, summarizePlanReceipt } from '@agendex/shared/receipts';
import { Hono } from 'hono';
import { launchOpenIn } from '../open-in.ts';

const plans = new Hono();

plans.get('/file-plans', async (c) => {
  const path = c.req.query('path');
  if (!path?.trim()) return c.json({ error: 'path is required' }, 400);
  const workspace = c.req.query('workspace');
  const allWorkspaces = c.req.query('allWorkspaces');
  if (allWorkspaces !== undefined && allWorkspaces !== 'true' && allWorkspaces !== 'false') {
    return c.json({ error: 'allWorkspaces must be true or false' }, 400);
  }
  if (allWorkspaces === 'true' && workspace !== undefined) {
    return c.json({ error: 'Use workspace or allWorkspaces, not both' }, 400);
  }
  if (workspace !== undefined) {
    try {
      if (!workspace.trim() || !statSync(workspace).isDirectory()) {
        return c.json({ error: 'workspace must be an existing directory' }, 400);
      }
    } catch {
      return c.json({ error: 'workspace must be an existing directory' }, 400);
    }
  }
  const limit = c.req.query('limit');
  const offset = c.req.query('offset');
  // Validate inputs before the service touches git or the plan index.
  if (path.includes('\0') || path.length > 4096) {
    return c.json({ error: 'path must be at most 4096 characters and contain no NUL' }, 400);
  }
  if (limit !== undefined && (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 100)) {
    return c.json({ error: 'limit must be an integer from 1 to 100' }, 400);
  }
  if (offset !== undefined && (!/^\d+$/.test(offset) || !Number.isSafeInteger(Number(offset)))) {
    return c.json({ error: 'offset must be a non-negative integer' }, 400);
  }
  return c.json(
    await getFilePlanHistory(path, {
      cwd: workspace,
      limit: limit === undefined ? undefined : Number(limit),
      offset: offset === undefined ? undefined : Number(offset),
      allWorkspaces: allWorkspaces === 'true',
    }),
  );
});

plans.post('/file-plan-counts', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }
  if (!body || typeof body !== 'object') return c.json({ error: 'paths are required' }, 400);
  const { paths, workspace, allWorkspaces } = body as {
    paths?: unknown;
    workspace?: unknown;
    allWorkspaces?: unknown;
  };
  if (
    !Array.isArray(paths) ||
    paths.length > 20 ||
    paths.some(
      (path) =>
        typeof path !== 'string' || !path.trim() || path.length > 4096 || path.includes('\0'),
    )
  ) {
    return c.json({ error: 'Provide at most 20 non-empty file paths' }, 400);
  }
  if (
    (workspace !== undefined && typeof workspace !== 'string') ||
    (allWorkspaces !== undefined && typeof allWorkspaces !== 'boolean') ||
    (workspace !== undefined && allWorkspaces === true)
  ) {
    return c.json({ error: 'Invalid workspace scope' }, 400);
  }
  if (typeof workspace === 'string') {
    try {
      if (!workspace.trim() || !statSync(workspace).isDirectory())
        return c.json({ error: 'workspace must be an existing directory' }, 400);
    } catch {
      return c.json({ error: 'workspace must be an existing directory' }, 400);
    }
  }
  return c.json({
    counts: await getFilePlanCounts(paths as string[], {
      cwd: workspace as string | undefined,
      allWorkspaces: allWorkspaces === true,
    }),
  });
});

function recoveryAssessment(plan: NonNullable<ReturnType<typeof getById>>) {
  const metadata = { ...plan.metadata };
  // Explain what automatic classification would do, even after a local restore.
  if (metadata.localPlanValueOverride === true) delete metadata.planValueOverride;
  return assessPlanValue({ ...plan, metadata });
}
type RecoveryKey = { time: number; id: string };
function recoveryKey(plan: NonNullable<ReturnType<typeof getById>>): RecoveryKey {
  return { time: plan.updatedAt.getTime(), id: plan.id };
}
/** Newest first, then id; shared by sorting and cursor paging. */
function compareRecoveryOrder(a: RecoveryKey, b: RecoveryKey): number {
  return b.time - a.time || a.id.localeCompare(b.id);
}
function isRecoveryPlan(plan: NonNullable<ReturnType<typeof getById>>) {
  return isLowValuePlan(plan) || plan.metadata.localPlanValueOverride === true;
}

// Authenticated local-only recovery surface. Never used by normal browse, MCP, or shares.
plans.get('/hidden-plans', (c) => {
  const rawLimit = c.req.query('limit') ?? '50';
  const rawOffset = c.req.query('offset') ?? '0';
  if (!/^\d+$/.test(rawLimit) || !/^\d+$/.test(rawOffset))
    return c.json({ error: 'invalid pagination' }, 400);
  const limit = Number(rawLimit);
  const offset = Number(rawOffset);
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    return c.json({ error: 'invalid pagination' }, 400);
  // `cursor` (from `nextCursor`) pages by sort key, so rows vanishing between requests
  // cannot shift later plans past the client the way a numeric offset would.
  const rawCursor = c.req.query('cursor');
  const cursor = rawCursor === undefined ? undefined : /^(\d{1,15}):(.+)$/.exec(rawCursor);
  if (cursor === null) return c.json({ error: 'invalid cursor' }, 400);
  const candidates = getAll()
    .filter(isRecoveryPlan)
    .sort((a, b) => compareRecoveryOrder(recoveryKey(a), recoveryKey(b)));
  let start = offset;
  if (cursor) {
    const after = { time: Number(cursor[1]), id: cursor[2] ?? '' };
    const index = candidates.findIndex(
      (plan) => compareRecoveryOrder(after, recoveryKey(plan)) < 0,
    );
    start = index === -1 ? candidates.length : index;
  }
  const page = candidates.slice(start, start + limit);
  const last = page.at(-1);
  return c.json({
    nextCursor:
      last && start + limit < candidates.length
        ? `${last.updatedAt.getTime()}:${last.id}`
        : undefined,
    plans: page.map((plan) => ({
      id: plan.id,
      title: plan.title,
      agent: plan.agent,
      workspace: plan.workspace,
      filePath: plan.filePath,
      updatedAt: plan.updatedAt.toISOString(),
      restored: plan.metadata.localPlanValueOverride === true,
      assessment: recoveryAssessment(plan),
    })),
    total: candidates.length,
    hiddenCount: candidates.filter(isLowValuePlan).length,
    limit,
    offset,
  });
});

plans.get('/hidden-plans/:id', async (c) => {
  const plan = getById(c.req.param('id'));
  if (!plan || !isRecoveryPlan(plan)) return c.json({ error: 'not found' }, 404);
  return c.json({ plan, assessment: recoveryAssessment(plan), check: await getPlanCheck(plan) });
});

plans.put('/hidden-plans/:id/override', async (c) => {
  const plan = getById(c.req.param('id'));
  if (!plan || !isRecoveryPlan(plan)) return c.json({ error: 'not found' }, 404);
  let body: { restore?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON' }, 400);
  }
  if (typeof body?.restore !== 'boolean')
    return c.json({ error: 'restore must be a boolean' }, 400);
  const updated = await setPlanValueOverride(plan.id, body.restore);
  if (!updated) return c.json({ error: 'plan source no longer indexed' }, 404);
  watcherOnChange?.(getIndexablePlans());
  return c.json({
    ok: true,
    hidden: isLowValuePlan(updated),
    restored: updated.metadata.localPlanValueOverride === true,
  });
});

plans.get('/plans', (c) => {
  const agent = c.req.query('agent');
  const q = c.req.query('q')?.trim();
  const workspace = c.req.query('workspace');
  // A search keeps relevance order unless the caller asks for another sort.
  const sort = c.req.query('sort') ?? (q ? 'relevance' : 'updatedAt');
  const limit = parseInt(c.req.query('limit') ?? '50', 10);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  let results = q ? searchPlans(getIndexablePlans(), q) : getIndexablePlans();

  if (agent) results = results.filter((p) => p.agent === agent);
  if (workspace) results = results.filter((p) => p.workspace?.includes(workspace));

  if (!(q && sort === 'relevance')) {
    results.sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title);
      if (sort === 'createdAt') return b.createdAt.getTime() - a.createdAt.getTime();
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });
  }

  const total = results.length;
  results = results.slice(offset, offset + limit);

  return c.json({ plans: results, total, limit, offset });
});

plans.get('/plans/:id', (c) => {
  const plan = getIndexableById(c.req.param('id'));
  if (!plan) return c.json({ error: 'not found' }, 404);
  return c.json(plan);
});

plans.post('/plans/:id/read', async (c) => {
  const plan = getIndexableById(c.req.param('id'));
  if (!plan) return c.json({ error: 'not found' }, 404);
  let body: { updatedAt?: unknown; content?: unknown; title?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return c.json({ error: 'updatedAt, title and content are required' }, 400);
  if (
    typeof body.updatedAt !== 'string' ||
    typeof body.content !== 'string' ||
    typeof body.title !== 'string'
  )
    return c.json({ error: 'updatedAt, title and content are required' }, 400);
  if (
    body.updatedAt !== plan.updatedAt.toISOString() ||
    body.content !== plan.content ||
    body.title !== plan.title
  )
    return c.json(
      { error: 'The displayed revision is stale. Reload the plan to record it as read.' },
      409,
    );
  return c.json(await openPlanRead({ ...plan, updatedAt: plan.updatedAt.toISOString() }));
});
plans.delete('/plans/:id/read', async (c) => {
  const plan = getIndexableById(c.req.param('id'));
  if (!plan) return c.json({ error: 'not found' }, 404);
  await clearPlanRead(plan);
  return c.json({ ok: true });
});

plans.get('/plans/:id/raw', (c) => {
  const plan = getIndexableById(c.req.param('id'));
  if (!plan) return c.json({ error: 'not found' }, 404);
  return c.text(plan.content);
});

plans.get('/plans/:id/session-cost', async (c) => {
  const plan = getIndexableById(c.req.param('id'));
  if (!plan) return c.json({ error: 'not found' }, 404);
  return c.json({ sessionCost: await getPlanSessionCost(plan, getIndexablePlans()) });
});

plans.get('/plans/:id/receipt', async (c) => {
  const plan = getIndexableById(c.req.param('id'));
  if (!plan) return c.json({ error: 'not found' }, 404);
  return c.json({ receipt: await getPlanReceipt(plan) });
});

plans.get('/plans/:id/check', async (c) => {
  const plan = getIndexableById(c.req.param('id'));
  if (!plan) return c.json({ error: 'not found' }, 404);
  return c.json({ check: await getPlanCheck(plan) });
});

/** Receipt summaries for list rows and the brief, keyed by plan id. `?ids=a,b` narrows the set. */
plans.get('/receipts', async (c) => {
  const ids = c.req
    .query('ids')
    ?.split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  // Unknown and hidden ids drop out here; the engine still uses every repo peer for windows.
  const subset = ids
    ? ids.flatMap((id) => {
        const plan = getIndexableById(id);
        return plan ? [plan] : [];
      })
    : undefined;
  const receipts = await getPlanReceipts(subset);
  const summaries: Record<string, PlanReceiptSummary> = {};
  for (const [planId, receipt] of receipts) summaries[planId] = summarizePlanReceipt(receipt);
  return c.json({ receipts: summaries });
});

/** baseDir for ./ siblings: the plan file's parent, when inside the workspace. */
function planBaseDir(plan: { filePath: string; workspace?: string }): string | undefined {
  if (!plan.workspace || !plan.filePath) return undefined;
  const parent = dirname(plan.filePath);
  return isWithinWorkspace(parent, plan.workspace) ? parent : undefined;
}

/**
 * Cloud plans have Convex ids, while the local index derives ids from source
 * paths. Fall back through the source path, but only to an already-indexed
 * local plan so the browser can never nominate an arbitrary workspace root.
 */
function localPlanForPathAction(planId: string, sourceFilePath: unknown) {
  const direct = getIndexableById(planId);
  if (direct) return direct;
  if (typeof sourceFilePath !== 'string' || !sourceFilePath.trim()) return undefined;

  let requestedRealPath: string;
  try {
    requestedRealPath = realpathSync(sourceFilePath.trim());
  } catch {
    return undefined;
  }

  return getIndexablePlans().find((plan) => {
    try {
      return realpathSync(plan.filePath) === requestedRealPath;
    } catch {
      return false;
    }
  });
}

plans.post('/plans/:id/paths/exists', async (c) => {
  const body = await c.req.json<{ paths?: unknown; sourceFilePath?: unknown }>();
  if (!Array.isArray(body.paths)) {
    return c.json({ error: 'paths must be an array' }, 400);
  }
  const plan = localPlanForPathAction(c.req.param('id'), body.sourceFilePath);
  if (!plan) return c.json({ error: 'local plan source not found' }, 404);

  const paths: string[] = [];
  for (const path of body.paths) {
    if (paths.length >= PATH_EXISTS_BATCH_LIMIT) break;
    if (typeof path === 'string' && path.length > 0 && path.length <= 1024) paths.push(path);
  }

  const results = await resolveCodeFileBatch(paths, plan.workspace, planBaseDir(plan));
  return c.json({ results });
});

plans.get('/open-in/agent-clis', (c) => c.json({ apps: detectHandoffClis() }));

plans.get('/open-in/apps', (c) => {
  return c.json({ available: true, apps: detectOpenInApps() });
});

plans.post('/plans/:id/open-in', async (c) => {
  const body = await c.req.json<{
    path?: unknown;
    line?: unknown;
    appId?: unknown;
    sourceFilePath?: unknown;
  }>();
  const plan = localPlanForPathAction(c.req.param('id'), body.sourceFilePath);
  if (!plan) return c.json({ error: 'local plan source not found' }, 404);
  if (!plan.workspace) {
    return c.json({ error: 'This plan has no workspace, so paths cannot be opened.' }, 400);
  }

  if (typeof body.path !== 'string' || !body.path.trim()) {
    return c.json({ error: 'path is required' }, 400);
  }
  const line =
    typeof body.line === 'number' && Number.isInteger(body.line) && body.line > 0
      ? body.line
      : undefined;
  const appId = typeof body.appId === 'string' && body.appId.trim() ? body.appId : 'reveal';

  const resolved = await resolveCodeFile(body.path, plan.workspace, planBaseDir(plan));
  if (resolved.status === 'ambiguous') {
    return c.json({ error: 'path is ambiguous in this workspace', matches: resolved.matches }, 409);
  }
  if (resolved.status !== 'found') {
    return c.json({ error: 'path not found in this workspace' }, 404);
  }

  const result = await launchOpenIn(appId, resolved.resolved, line);
  if (!result.ok) return c.json({ ok: false, error: result.error }, 502);
  return c.json({ ok: true });
});

plans.get('/plans/:id/annotations', async (c) => {
  const planId = c.req.param('id');
  const plan = getIndexableById(planId);
  if (!plan) return c.json({ error: 'not found' }, 404);
  return c.json({ annotations: await listPlanAnnotations(planId) });
});

plans.post('/plans/:id/annotations', async (c) => {
  const planId = c.req.param('id');
  const plan = getIndexableById(planId);
  if (!plan) return c.json({ error: 'not found' }, 404);

  const body = await c.req.json<{
    type?: 'comment' | 'replacement' | 'deletion' | 'insertion' | 'global_comment';
    status?: 'draft' | 'open' | 'submitted' | 'resolved';
    body?: string;
    replacementText?: string;
    anchor?: {
      quote?: string;
      startOffset?: number;
      endOffset?: number;
      occurrenceIndex?: number;
      prefix?: string;
      suffix?: string;
      contentHash?: string;
    };
  }>();

  if (
    body.type !== 'comment' &&
    body.type !== 'replacement' &&
    body.type !== 'deletion' &&
    body.type !== 'insertion' &&
    body.type !== 'global_comment'
  ) {
    return c.json({ error: 'invalid annotation type' }, 400);
  }

  const CREATE_VALID_STATUSES = new Set(['draft', 'open', 'resolved']);
  if (body.status !== undefined && !CREATE_VALID_STATUSES.has(body.status)) {
    return c.json({ error: 'invalid annotation status' }, 400);
  }

  const anchor = body.anchor ?? {};
  let validated: { body?: string; replacementText?: string };
  try {
    validated = validatePlanAnnotationInput({
      type: body.type,
      status: body.status,
      body: body.body,
      replacementText: body.replacementText,
      anchor,
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'invalid annotation input' }, 400);
  }

  const annotation = await createPlanAnnotation(planId, {
    type: body.type,
    status: body.status ?? 'open',
    body: validated.body,
    replacementText: validated.replacementText,
    anchor,
    source: 'agendex-local',
  });

  return c.json(annotation, 201);
});

plans.patch('/plans/:id/annotations/:annotationId', async (c) => {
  const planId = c.req.param('id');
  const plan = getIndexableById(planId);
  if (!plan) return c.json({ error: 'not found' }, 404);

  const body = await c.req.json<{
    status?: 'draft' | 'open' | 'submitted' | 'resolved';
    writebackId?: string;
  }>();
  const VALID_STATUSES = new Set(['draft', 'open', 'submitted', 'resolved']);
  if (body.status !== undefined && !VALID_STATUSES.has(body.status)) {
    return c.json({ error: 'invalid annotation status' }, 400);
  }

  const annotation = await updatePlanAnnotationStatus({
    planId,
    annotationId: c.req.param('annotationId'),
    status: body.status,
    writebackId: body.writebackId,
  });
  if (!annotation) return c.json({ error: 'annotation not found' }, 404);
  return c.json(annotation);
});

plans.delete('/plans/:id/annotations/:annotationId', async (c) => {
  const planId = c.req.param('id');
  const plan = getIndexableById(planId);
  if (!plan) return c.json({ error: 'not found' }, 404);
  const ok = await deletePlanAnnotation(planId, c.req.param('annotationId'));
  if (!ok) return c.json({ error: 'annotation not found' }, 404);
  return c.json({ ok: true });
});

plans.put('/plans/:id', (c) => {
  return c.json({ error: 'Plan editing requires Cloud Pro' }, 403);
});

plans.post('/plans', (c) => {
  return c.json({ error: 'Plan creation requires Cloud Pro' }, 403);
});

plans.get('/agents', (c) => {
  return c.json(getAgentStats());
});

plans.post('/rescan', async (c) => {
  await scan();
  return c.json({ ok: true });
});

// Custom plan directory management
let watcherOnChange: ((plans: unknown[]) => void) | undefined;

export function setPlanSourcesWatcherCallback(cb: (plans: unknown[]) => void) {
  watcherOnChange = cb;
}

plans.get('/plan-sources', (c) => {
  const config = loadConfig();
  return c.json({ customPlanDirs: config?.customPlanDirs ?? [] });
});

plans.post('/plan-sources', async (c) => {
  const body = await c.req.json<{ path?: string }>();
  if (typeof body.path !== 'string' || !body.path.trim()) {
    return c.json({ error: 'path is required' }, 400);
  }
  const requestedPath = body.path;
  const resolved = resolveCustomPlanDirPath(requestedPath);
  if (!existsSync(resolved)) {
    return c.json({ error: `path does not exist: ${resolved}` }, 400);
  }
  if (!statSync(resolved).isDirectory()) {
    return c.json({ error: `path is not a directory: ${resolved}` }, 400);
  }
  let updated: string[] = [];
  updateConfig((config) => {
    updated = normalizeCustomPlanDirs([...(config?.customPlanDirs ?? []), resolved]);
    return {
      ...(config ?? { configVersion: CURRENT_CONFIG_VERSION, enabledAdapters: [] }),
      customPlanDirs: updated,
    };
  });
  await scan();
  startWatching(watcherOnChange);
  return c.json({ customPlanDirs: updated });
});

plans.delete('/plan-sources', async (c) => {
  const body = await c.req.json<{ path?: string }>();
  if (typeof body.path !== 'string' || !body.path.trim()) {
    return c.json({ error: 'path is required' }, 400);
  }
  const requestedPath = body.path;
  const resolved = resolveCustomPlanDirPath(requestedPath);
  let updated: string[] | null = null;
  updateConfig((config) => {
    updated = removeCustomPlanDir(config?.customPlanDirs ?? [], requestedPath);
    if (updated === null) return null;
    return {
      ...(config ?? { configVersion: CURRENT_CONFIG_VERSION, enabledAdapters: [] }),
      customPlanDirs: updated,
    };
  });
  if (updated === null) {
    return c.json({ error: `path not in custom plan sources: ${resolved}` }, 404);
  }
  await scan();
  startWatching(watcherOnChange);
  return c.json({ customPlanDirs: updated });
});

export { plans };
