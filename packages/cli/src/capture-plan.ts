import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { getConfigDir } from '@agendex/shared';

export type CapturePlanAgent =
  | 'antigravity'
  | 'augment'
  | 'command-code'
  | 'gemini-cli'
  | 'iflow-cli';

const CAPTURE_AGENTS = new Set<CapturePlanAgent>([
  'antigravity',
  'augment',
  'command-code',
  'gemini-cli',
  'iflow-cli',
]);
const PLAN_FILENAMES = new Set(['implementation_plan.md', 'implementation-plan.md', 'plan.md']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringValue(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

function isWithin(path: string, root: string): boolean {
  const resolvedPath = resolve(path);
  const resolvedRoot = resolve(root);
  return resolvedPath === resolvedRoot || resolvedPath.startsWith(resolvedRoot + sep);
}

async function canonicalPath(path: string): Promise<string | undefined> {
  try {
    return await realpath(path);
  } catch {
    return undefined;
  }
}

function isKnownPlanPath(agent: CapturePlanAgent, path: string): boolean {
  const normalized = resolve(path).replaceAll('\\', '/').toLowerCase();
  const filename = basename(normalized);
  if (!normalized.endsWith('.md')) return false;
  if (agent === 'antigravity') return PLAN_FILENAMES.has(filename);
  if (agent === 'gemini-cli') return normalized.includes('/plans/');
  if (agent === 'iflow-cli') return normalized.endsWith('/.iflow/plan.md');
  return PLAN_FILENAMES.has(filename) || normalized.includes('/plans/');
}

function candidatePaths(agent: CapturePlanAgent, payload: Record<string, unknown>): string[] {
  const candidates = new Set<string>();
  const artifactDirectory = stringValue(payload, [
    'artifactDirectoryPath',
    'artifact_directory_path',
  ]);
  if (artifactDirectory) {
    for (const filename of PLAN_FILENAMES) {
      const path = join(artifactDirectory, filename);
      if (existsSync(path)) candidates.add(path);
    }
  }

  const toolCall = isRecord(payload.toolCall) ? payload.toolCall : undefined;
  const toolArgs = toolCall && isRecord(toolCall.args) ? toolCall.args : undefined;
  if (toolArgs) {
    const path = stringValue(toolArgs, [
      'file_path',
      'filePath',
      'path',
      'TargetFile',
      'target_file',
    ]);
    if (path) candidates.add(path);
  }

  if (agent === 'iflow-cli') {
    for (const workspace of stringArray(payload.workspacePaths ?? payload.workspace_paths)) {
      const path = join(workspace, '.iflow', 'plan.md');
      if (existsSync(path)) candidates.add(path);
    }
  }

  return [...candidates].filter((path) => isKnownPlanPath(agent, path));
}

function directPlanContent(payload: Record<string, unknown>): string | undefined {
  const direct = stringValue(payload, ['plan', 'planContent', 'plan_content']);
  if (direct) return direct;
  const artifact = isRecord(payload.artifact) ? payload.artifact : undefined;
  if (!artifact) return undefined;
  const artifactType = stringValue(artifact, ['type', 'kind', 'name'])?.toLowerCase();
  if (!artifactType?.includes('plan')) return undefined;
  return stringValue(artifact, ['content', 'markdown']);
}

export async function capturePlanFromHook(
  agent: CapturePlanAgent,
  payload: unknown,
): Promise<string[]> {
  if (!CAPTURE_AGENTS.has(agent)) throw new Error(`Unsupported capture agent: ${agent}`);
  if (!isRecord(payload)) throw new Error('Hook payload must be a JSON object');

  const conversationId =
    stringValue(payload, ['conversationId', 'conversation_id', 'sessionId', 'session_id']) ??
    'latest';
  const destinationDir = join(
    getConfigDir(),
    'plans',
    'hooks',
    safeSegment(agent),
    safeSegment(conversationId),
  );
  await mkdir(destinationDir, { recursive: true });

  const allowedRoots = [
    ...stringArray(payload.workspacePaths ?? payload.workspace_paths),
    ...[stringValue(payload, ['artifactDirectoryPath', 'artifact_directory_path'])].filter(
      (value): value is string => Boolean(value),
    ),
  ];
  const canonicalRoots = (
    await Promise.all(allowedRoots.map((root) => canonicalPath(root)))
  ).filter((root): root is string => Boolean(root));
  const captured: string[] = [];

  for (const sourcePath of candidatePaths(agent, payload)) {
    const canonicalSource = await canonicalPath(sourcePath);
    if (
      !canonicalSource ||
      canonicalRoots.length === 0 ||
      !canonicalRoots.some((root) => isWithin(canonicalSource, root))
    )
      continue;
    try {
      const content = await readFile(canonicalSource, 'utf-8');
      const destination = join(destinationDir, safeSegment(basename(sourcePath)));
      await writeFile(
        destination,
        `---\nagent: ${agent}\nsource: hook\nsessionId: ${safeSegment(conversationId)}\n---\n${content}`,
        'utf-8',
      );
      captured.push(destination);
    } catch {
      // The source may be transient and disappear between hook delivery and capture.
    }
  }

  const inlineContent = directPlanContent(payload);
  if (inlineContent) {
    const destination = join(destinationDir, 'plan.md');
    await writeFile(
      destination,
      `---\nagent: ${agent}\nsource: hook\nsessionId: ${safeSegment(conversationId)}\n---\n${inlineContent}`,
      'utf-8',
    );
    if (!captured.includes(destination)) captured.push(destination);
  }

  return captured;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

export async function runCapturePlanCommand(args: string[], input?: string): Promise<number> {
  const agentIndex = args.indexOf('--agent');
  const agent = agentIndex >= 0 ? args[agentIndex + 1] : undefined;
  if (!agent || !CAPTURE_AGENTS.has(agent as CapturePlanAgent)) {
    console.error(
      '[agendex] usage: agendex capture-plan --agent <antigravity|augment|command-code|gemini-cli|iflow-cli>',
    );
    return 1;
  }

  try {
    const raw = input ?? (await readStdin());
    if (!raw.trim()) throw new Error('Hook payload is empty');
    const payload: unknown = JSON.parse(raw);
    await capturePlanFromHook(agent as CapturePlanAgent, payload);
    return 0;
  } catch (error) {
    console.error(
      `[agendex] could not capture hook plan: ${error instanceof Error ? error.message : error}`,
    );
    return 1;
  }
}
