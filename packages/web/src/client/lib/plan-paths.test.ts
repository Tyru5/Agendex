import { describe, expect, test } from 'bun:test';
import {
  candidatePathsForValidation,
  extractCandidateCodePaths,
  isCodeFilePath,
  isCodeFilePathStrict,
  parseCodePath,
  splitBareCodePathText,
} from './plan-paths.ts';

describe('parseCodePath', () => {
  const cases: Array<{
    input: string;
    expected: { path: string; line?: number; lineEnd?: number } | null;
  }> = [
    { input: 'packages/web/src/foo.ts', expected: { path: 'packages/web/src/foo.ts' } },
    {
      input: 'packages/web/src/foo.ts:12',
      expected: { path: 'packages/web/src/foo.ts', line: 12 },
    },
    {
      input: 'packages/web/src/foo.ts:12-30',
      expected: { path: 'packages/web/src/foo.ts', line: 12, lineEnd: 30 },
    },
    {
      input: 'packages/web/src/foo.ts:30-12',
      expected: { path: 'packages/web/src/foo.ts', line: 12, lineEnd: 30 },
    },
    {
      input: 'src/app.py#L42',
      expected: { path: 'src/app.py', line: 42 },
    },
    {
      input: 'src/app.py#L42-L50',
      expected: { path: 'src/app.py', line: 42, lineEnd: 50 },
    },
    { input: 'docs/setup.md#install', expected: { path: 'docs/setup.md' } },
    { input: 'App.tsx', expected: { path: 'App.tsx' } },
    { input: 'Dockerfile', expected: { path: 'Dockerfile' } },
    { input: 'ops/Makefile', expected: { path: 'ops/Makefile' } },
    { input: '.env.local', expected: { path: '.env.local' } },
    { input: '.gitignore', expected: { path: '.gitignore' } },
    { input: './relative/mod.rs', expected: { path: './relative/mod.rs' } },
    { input: '/abs/path/main.go', expected: { path: '/abs/path/main.go' } },
    {
      input: String.raw`C:\repo\src\App.tsx:42`,
      expected: { path: 'C:/repo/src/App.tsx', line: 42 },
    },
    // Trailing prose punctuation stripped
    { input: 'src/index.ts.', expected: { path: 'src/index.ts' } },
    { input: 'src/index.ts,', expected: { path: 'src/index.ts' } },
    // Rejections
    { input: 'https://example.com/foo.ts', expected: null },
    { input: 'src/**/*.ts', expected: null },
    { input: 'src/{a,b}.ts', expected: null },
    { input: 'src/foo bar.ts', expected: null },
    { input: 'notafile', expected: null },
    { input: 'foo.unknownext', expected: null },
    { input: 'v1.2.3', expected: null },
    { input: '', expected: null },
  ];

  for (const { input, expected } of cases) {
    // User story: path mentions are parsed predictably before local validation.
    test(`parses ${JSON.stringify(input)}`, () => {
      const parsed = parseCodePath(input);
      if (expected === null) {
        expect(parsed).toBeNull();
      } else {
        expect(parsed).not.toBeNull();
        expect(parsed?.path).toBe(expected.path);
        expect(parsed?.line).toBe(expected.line);
        expect(parsed?.lineEnd).toBe(expected.lineEnd);
        expect(parsed?.raw).toBe(input);
      }
    });
  }
});

describe('strictness rules', () => {
  // User story: inline code can link a file in the plan's own directory.
  test('backtick rule allows bare basenames', () => {
    expect(isCodeFilePath('Button.tsx')).toBe(true);
  });

  // User story: ordinary prose does not turn every filename-looking word into a control.
  test('bare-prose rule requires a slash', () => {
    expect(isCodeFilePathStrict('Button.tsx')).toBe(false);
    expect(isCodeFilePathStrict('ui/Button.tsx')).toBe(true);
  });
});

describe('extractCandidateCodePaths', () => {
  // User story: explicit inline-code paths are discovered for local validation.
  test('collects inline code paths including bare basenames', () => {
    const md = 'Edit `packages/web/src/foo.ts:12` and `Button.tsx` next.';
    const paths = extractCandidateCodePaths(md);
    expect(paths.map((p) => p.path)).toEqual(['packages/web/src/foo.ts', 'Button.tsx']);
    expect(paths[0]?.line).toBe(12);
  });

  // User story: readable path mentions in prose become openable without backticks.
  test('collects strict bare-prose paths but not bare words', () => {
    const md = 'Update packages/app/server.ts and skip config or Button.tsx here.';
    const paths = extractCandidateCodePaths(md);
    expect(paths.map((p) => p.path)).toEqual(['packages/app/server.ts']);
  });

  // User story: code examples never trigger filesystem validation requests.
  test('ignores fenced code blocks', () => {
    const md = ['Before `real/path.ts`.', '```ts', "import x from 'fenced/skip.ts';", '```'].join(
      '\n',
    );
    const paths = extractCandidateCodePaths(md);
    expect(paths.map((p) => p.path)).toEqual(['real/path.ts']);
  });

  // User story: hidden author notes never create source-path controls.
  test('ignores HTML comments', () => {
    const md = 'Visible `a/b.ts` <!-- hidden/skip.ts -->';
    expect(extractCandidateCodePaths(md).map((p) => p.path)).toEqual(['a/b.ts']);
  });

  // User story: web links remain navigation links instead of local-file actions.
  test('ignores URLs in prose and markdown links', () => {
    const md =
      'See https://github.com/foo/bar/blob/main/src/x.ts and [doc](https://example.com/a/b.md) but keep src/real.ts';
    const paths = extractCandidateCodePaths(md);
    expect(paths.map((p) => p.path)).toEqual(['src/real.ts']);
  });

  // User story: relative Markdown links remain links and are not treated as source mentions.
  test('ignores relative markdown link targets', () => {
    const md = 'See [the plan](./goals/jump/plan.md) for details.';
    expect(extractCandidateCodePaths(md)).toEqual([]);
  });

  // User story: repeated mentions require only one local filesystem lookup.
  test('dedupes repeated mentions', () => {
    const md = 'First `src/a.ts` then src/a.ts again, and `src/a.ts:5`.';
    const paths = extractCandidateCodePaths(md);
    expect(paths).toHaveLength(2);
    expect(candidatePathsForValidation(paths)).toEqual(['src/a.ts']);
  });

  // User story: patterns remain prose rather than unsafe or misleading file actions.
  test('rejects globs and spaced tokens in prose', () => {
    const md = 'Run on src/**/*.ts and src/{a,b}.tsx patterns.';
    expect(extractCandidateCodePaths(md)).toEqual([]);
  });
});

describe('splitBareCodePathText', () => {
  // User story: the Markdown renderer receives the same bare paths the validator discovered.
  test('splits POSIX and Windows path mentions from surrounding prose', () => {
    expect(splitBareCodePathText(String.raw`Edit src/main.ts and C:\repo\App.tsx today.`)).toEqual([
      { value: 'Edit ', isPath: false },
      { value: 'src/main.ts', isPath: true },
      { value: ' and ', isPath: false },
      { value: String.raw`C:\repo\App.tsx`, isPath: true },
      { value: ' today.', isPath: false },
    ]);
  });
});
