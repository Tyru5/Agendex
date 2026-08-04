import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clearPathResolveCache,
  isWithinWorkspace,
  resolveCodeFile,
  resolveCodeFileBatch,
  warmCodeFileList,
} from './path-resolve.ts';

let workspace: string;
let outside: string;

beforeEach(async () => {
  clearPathResolveCache();
  workspace = await mkdtemp(join(tmpdir(), 'agendex-resolve-ws-'));
  outside = await mkdtemp(join(tmpdir(), 'agendex-resolve-out-'));

  await mkdir(join(workspace, 'packages', 'web', 'src'), { recursive: true });
  await mkdir(join(workspace, 'packages', 'app'), { recursive: true });
  await mkdir(join(workspace, 'node_modules', 'dep'), { recursive: true });
  await mkdir(join(workspace, 'plans'), { recursive: true });

  await writeFile(join(workspace, 'packages', 'web', 'src', 'App.tsx'), 'web');
  await writeFile(join(workspace, 'packages', 'app', 'App.tsx'), 'app');
  await writeFile(join(workspace, 'packages', 'web', 'src', 'unique.ts'), 'unique');
  await writeFile(join(workspace, 'node_modules', 'dep', 'index.ts'), 'dep');
  await writeFile(join(workspace, 'plans', 'sibling.md'), 'sibling');
  await writeFile(join(outside, 'secret.ts'), 'secret');
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe('isWithinWorkspace', () => {
  // User story: files inside a plan workspace are eligible source targets.
  test('accepts files under the workspace', () => {
    expect(isWithinWorkspace(join(workspace, 'packages', 'app', 'App.tsx'), workspace)).toBe(true);
  });

  // User story: local source actions cannot escape to neighboring directories.
  test('rejects files outside the workspace', () => {
    expect(isWithinWorkspace(join(outside, 'secret.ts'), workspace)).toBe(false);
  });

  // User story: stale or nonexistent source paths are never presented as openable.
  test('rejects missing paths', () => {
    expect(isWithinWorkspace(join(workspace, 'nope.ts'), workspace)).toBe(false);
  });
});

describe('warmCodeFileList', () => {
  // User story: abbreviated path lookup is fast without indexing dependency trees.
  test('lists files and skips ignored directories', async () => {
    const files = await warmCodeFileList(workspace);
    const posix = files.map((f) => f.split('\\').join('/'));
    expect(posix).toContain('packages/web/src/unique.ts');
    expect(posix.some((f) => f.includes('node_modules'))).toBe(false);
  });
});

describe('resolveCodeFile', () => {
  // User story: a workspace-relative source mention resolves directly.
  test('resolves exact relative paths', async () => {
    const result = await resolveCodeFile('packages/web/src/unique.ts', workspace);
    expect(result.status).toBe('found');
    if (result.status === 'found') {
      expect(result.relative).toBe('packages/web/src/unique.ts');
    }
  });

  // User story: absolute source mentions inside the workspace remain usable.
  test('resolves absolute paths inside the workspace', async () => {
    const abs = join(workspace, 'packages', 'app', 'App.tsx');
    const result = await resolveCodeFile(abs, workspace);
    expect(result.status).toBe('found');
  });

  // User story: absolute paths outside the workspace remain inaccessible.
  test('rejects absolute paths outside the workspace', async () => {
    const result = await resolveCodeFile(join(outside, 'secret.ts'), workspace);
    expect(result.status).toBe('missing');
  });

  // User story: relative traversal cannot escape the workspace boundary.
  test('rejects .. traversal escaping the workspace', async () => {
    const result = await resolveCodeFile('../' + 'secret.ts', workspace);
    expect(result.status).toBe('missing');
  });

  // User story: plan-relative links resolve beside the source plan file.
  test('resolves ./ siblings relative to baseDir', async () => {
    const result = await resolveCodeFile('./sibling.md', workspace, join(workspace, 'plans'));
    expect(result.status).toBe('found');
    if (result.status === 'found') expect(result.relative).toBe('plans/sibling.md');
  });

  // User story: an explicit plan-relative path takes precedence over a root duplicate.
  test('prefers plan-local ./ over a same-named workspace-root file', async () => {
    await writeFile(join(workspace, 'sibling.md'), 'root');
    const result = await resolveCodeFile('./sibling.md', workspace, join(workspace, 'plans'));
    expect(result.status).toBe('found');
    if (result.status === 'found') expect(result.relative).toBe('plans/sibling.md');
  });

  // User story: a missing explicit sibling does not silently open an unrelated file.
  test('does not fall back from missing ./ siblings to another same-named file', async () => {
    await writeFile(join(workspace, 'only-root.md'), 'root');
    const result = await resolveCodeFile('./only-root.md', workspace, join(workspace, 'plans'));
    expect(result.status).toBe('missing');
  });

  // User story: plan-relative paths stay unavailable when no safe plan directory is known.
  test('treats ./ as missing when plan baseDir is unavailable', async () => {
    await writeFile(join(workspace, 'sibling.md'), 'root');
    const result = await resolveCodeFile('./sibling.md', workspace);
    expect(result.status).toBe('missing');
  });

  // User story: abbreviated source mentions resolve across casing differences.
  test('suffix-matches abbreviated paths case-insensitively', async () => {
    const result = await resolveCodeFile('src/UNIQUE.ts', workspace);
    expect(result.status).toBe('found');
    if (result.status === 'found') {
      expect(result.relative).toBe('packages/web/src/unique.ts');
    }
  });

  // User story: duplicate filenames require the user to choose the intended match.
  test('reports ambiguous basename matches', async () => {
    const result = await resolveCodeFile('App.tsx', workspace);
    expect(result.status).toBe('ambiguous');
    if (result.status === 'ambiguous') {
      expect(result.matches.sort()).toEqual(['packages/app/App.tsx', 'packages/web/src/App.tsx']);
    }
  });

  // User story: a unique filename can be opened without spelling its full path.
  test('resolves unique basenames', async () => {
    const result = await resolveCodeFile('unique.ts', workspace);
    expect(result.status).toBe('found');
  });

  // User story: deleted files stop being openable even while the search cache is warm.
  test('treats deleted fuzzy matches as missing until the cache expires', async () => {
    // Warm the file list, then delete the only basename match. Fuzzy resolution
    // must re-stat before returning found so open-in cannot launch a dead path.
    expect((await resolveCodeFile('unique.ts', workspace)).status).toBe('found');
    await rm(join(workspace, 'packages', 'web', 'src', 'unique.ts'));
    expect((await resolveCodeFile('unique.ts', workspace)).status).toBe('missing');
    expect((await resolveCodeFile('src/UNIQUE.ts', workspace)).status).toBe('missing');
  });

  // User story: unknown source mentions render as unavailable rather than failing.
  test('reports missing for unknown paths', async () => {
    const result = await resolveCodeFile('does/not/exist.ts', workspace);
    expect(result.status).toBe('missing');
  });

  // User story: plans without a local workspace degrade safely.
  test('reports unavailable without a workspace', async () => {
    const result = await resolveCodeFile('a.ts', join(workspace, 'no-such-dir'));
    expect(result.status).toBe('unavailable');
  });
});

describe('resolveCodeFileBatch', () => {
  // User story: a plan validates all unique source mentions in one batch.
  test('returns a result per unique input path', async () => {
    const results = await resolveCodeFileBatch(
      ['packages/web/src/unique.ts', 'App.tsx', 'missing.ts', 'packages/web/src/unique.ts'],
      workspace,
    );
    expect(Object.keys(results)).toHaveLength(3);
    expect(results['packages/web/src/unique.ts']?.status).toBe('found');
    expect(results['App.tsx']?.status).toBe('ambiguous');
    expect(results['missing.ts']?.status).toBe('missing');
  });

  // User story: batch validation degrades consistently when no workspace exists.
  test('marks everything unavailable without a workspace', async () => {
    const results = await resolveCodeFileBatch(['a.ts'], undefined);
    expect(results['a.ts']?.status).toBe('unavailable');
  });
});
