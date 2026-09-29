import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Plan } from '../types.ts';
import { getPlanCheck } from './plan-check.ts';
import { clearPathResolveCache } from './path-resolve.ts';

test('API plan check resolves beyond the path batch limit instead of truncating results', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'agendex-check-batches-'));
  try {
    await mkdir(join(workspace, 'src'));
    await writeFile(join(workspace, 'src', 'file500.ts'), 'export {};');
    clearPathResolveCache();
    const plan: Plan = {
      id: 'batched',
      title: 'Batched plan',
      agent: 'test',
      workspace,
      filePath: join(workspace, 'plan.md'),
      content: Array.from({ length: 501 }, (_, index) => `Update \`src/file${index}.ts\`.`).join(
        '\n',
      ),
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {},
    };
    const check = await getPlanCheck(plan);
    expect(check.fileCount).toBe(501);
    expect(check.checkedFileCount).toBe(501);
    expect(check.pathStatus).toBe('ready');
    const missing = check.findings.find((finding) => finding.code === 'missing-files')?.paths ?? [];
    expect(missing.length).toBe(500);
    expect(missing.includes('src/file500.ts')).toBe(false);
    expect(missing.includes('src/file499.ts')).toBe(true);
  } finally {
    clearPathResolveCache();
    await rm(workspace, { recursive: true, force: true });
  }
});
