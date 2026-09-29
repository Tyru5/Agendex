import { expect, test } from 'bun:test';
import {
  extractCloudFileMentions,
  MAX_FILE_MENTIONS,
  normalizeFileMentionPath,
} from './filePlanMentionIndex';

test('cloud mention paths normalize line anchors, dots, quotes and Windows separators', () => {
  expect(normalizeFileMentionPath('"./src/my file.ts:12#L12"')).toBe('src/my file.ts');
  expect(normalizeFileMentionPath('src/old/../new.ts')).toBe('src/new.ts');
  expect(normalizeFileMentionPath('c:\\repo\\src\\auth.ts', 'C:/repo/')).toBe('src/auth.ts');
  expect(normalizeFileMentionPath('/repo/src/new.ts', '/repo')).toBe('src/new.ts');
  expect(normalizeFileMentionPath('../src/auth.ts', '/repo', '/repo/plans')).toBe('src/auth.ts');
});

test('absolute mentions require a whole workspace prefix and escapes never normalize', () => {
  for (const path of [
    '/other/src/a.ts',
    '/repo-other/src/a.ts',
    '../outside.ts',
    'src/../../outside.ts',
    'https://example.com/src/a.ts',
    'src/*.ts',
    'src/a.ts\0',
  ]) {
    expect(normalizeFileMentionPath(path, '/repo')).toBeNull();
  }
  expect(normalizeFileMentionPath('/repo/src/a.ts')).toBeNull();
});

test('extracts deduped new/deleted and spaced mentions without reading a filesystem', () => {
  const result = extractCloudFileMentions({
    workspace: '/repo',
    filePath: '/repo/plans/feature.md',
    content:
      '# Implementation\nCreate `src/new.ts` and remove "src/deleted file.ts".\nEdit `../src/auth.ts:4` and `src/new.ts#L5`.\n```ts\nconst example = "src/example.ts";\n```\n<!-- src/private.ts -->\n',
  });
  expect(result.paths.sort()).toEqual(['src/auth.ts', 'src/deleted file.ts', 'src/new.ts']);
  expect(result.truncated).toBe(false);
});

test('oversized path sets expose partial indexing rather than claiming completion', () => {
  const result = extractCloudFileMentions({
    content: Array.from(
      { length: MAX_FILE_MENTIONS + 1 },
      (_, i) => `Edit \`src/file${i}.ts\``,
    ).join('\n'),
  });
  expect(result.paths.length).toBe(MAX_FILE_MENTIONS);
  expect(result.truncated).toBe(true);
});

test('absolute mentions never acquire a second root-relative alias', () => {
  const result = extractCloudFileMentions({
    workspace: '/repo',
    content: 'Edit /repo/src/a.ts and `/repo/src/b.ts`. Ignore "/repo-other/src/c.ts".',
  });
  expect(result.paths.sort()).toEqual(['src/a.ts', 'src/b.ts']);
});

test('quoted command snippets never become file paths', () => {
  const result = extractCloudFileMentions({
    content:
      'Run `bun test src/auth.test.ts`, `npm run build src/auth.ts`, `cat src/auth.ts`, and `git diff src/auth.ts`. Edit `src/my file.ts`.',
  });
  expect(result.paths).toEqual(['src/my file.ts']);
});
