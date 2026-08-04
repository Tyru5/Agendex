/**
 * Jump-to-source path model: detect code-file paths mentioned in plan
 * markdown so they can be validated against the plan workspace and opened
 * locally. Pure string logic — no filesystem access.
 */

export interface ParsedCodePath {
  /** Original text as it appeared in the plan (before stripping). */
  raw: string;
  /** Cleaned path with line suffix and anchors removed. */
  path: string;
  line?: number;
  lineEnd?: number;
}

const CODE_FILE_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'mts',
  'cts',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'kts',
  'swift',
  'c',
  'h',
  'cc',
  'cpp',
  'hpp',
  'cxx',
  'hxx',
  'm',
  'mm',
  'cs',
  'php',
  'scala',
  'clj',
  'cljs',
  'ex',
  'exs',
  'erl',
  'hrl',
  'lua',
  'dart',
  'sql',
  'sh',
  'bash',
  'zsh',
  'fish',
  'ps1',
  'psm1',
  'bat',
  'cmd',
  'html',
  'htm',
  'css',
  'scss',
  'sass',
  'less',
  'styl',
  'vue',
  'svelte',
  'astro',
  'json',
  'jsonc',
  'json5',
  'yaml',
  'yml',
  'toml',
  'ini',
  'cfg',
  'conf',
  'env',
  'xml',
  'svg',
  'md',
  'mdx',
  'markdown',
  'rst',
  'txt',
  'graphql',
  'gql',
  'proto',
  'prisma',
  'tf',
  'tfvars',
  'hcl',
  'lock',
  'gradle',
  'properties',
  'plist',
  'rake',
  'gemspec',
  'podspec',
  'r',
  'jl',
  'nim',
  'zig',
  'sol',
]);

const SPECIAL_BASENAMES = new Set([
  'dockerfile',
  'makefile',
  'rakefile',
  'gemfile',
  'procfile',
  'justfile',
  'brewfile',
  'vagrantfile',
]);

const SPECIAL_DOTFILES = new Set([
  '.gitignore',
  '.gitattributes',
  '.npmrc',
  '.nvmrc',
  '.editorconfig',
  '.env',
]);

/** Characters that make a token implausible as a single file path. */
const IMPLAUSIBLE_CHARS = /[{}*?<>|"`\s\\]/;

function basenameOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function hasCodeExtension(basename: string): boolean {
  const lower = basename.toLowerCase();
  if (SPECIAL_BASENAMES.has(lower)) return true;
  if (SPECIAL_DOTFILES.has(lower) || lower.startsWith('.env.')) return true;
  const dot = lower.lastIndexOf('.');
  if (dot <= 0 || dot === lower.length - 1) return false;
  return CODE_FILE_EXTENSIONS.has(lower.slice(dot + 1));
}

/**
 * Parse a raw mention into a clean path plus optional line range.
 * Handles `path:12`, `path:12-30`, and `path#L12` / `path#L12-L30`;
 * other `#anchor` suffixes are stripped. Returns null when the token is
 * not a plausible code-file path.
 */
export function parseCodePath(raw: string): ParsedCodePath | null {
  let value = raw.trim();
  if (!value || value.length > 1024) return null;
  if (value.includes('://')) return null;

  let line: number | undefined;
  let lineEnd: number | undefined;

  const hashIdx = value.indexOf('#');
  if (hashIdx >= 0) {
    const anchor = value.slice(hashIdx + 1);
    value = value.slice(0, hashIdx);
    const lineAnchor = /^L(\d+)(?:-L?(\d+))?$/.exec(anchor);
    if (lineAnchor?.[1]) {
      line = parseInt(lineAnchor[1], 10);
      if (lineAnchor[2]) lineEnd = parseInt(lineAnchor[2], 10);
    }
  }

  const lineSuffix = /:(\d+)(?:-(\d+))?$/.exec(value);
  if (lineSuffix?.[1]) {
    value = value.slice(0, lineSuffix.index);
    line = parseInt(lineSuffix[1], 10);
    if (lineSuffix[2]) lineEnd = parseInt(lineSuffix[2], 10);
  }

  if (line !== undefined && lineEnd !== undefined && lineEnd < line) {
    [line, lineEnd] = [lineEnd, line];
  }

  // Trailing punctuation from prose ("see foo/bar.ts.", "(foo/bar.ts)").
  value = value.replace(/[.,;)\]]+$/, '');

  if (!value || IMPLAUSIBLE_CHARS.test(value)) return null;
  if (!hasCodeExtension(basenameOf(value))) return null;

  const result: ParsedCodePath = { raw, path: value };
  if (line !== undefined) result.line = line;
  if (lineEnd !== undefined) result.lineEnd = lineEnd;
  return result;
}

/** Backtick rule: a bare basename is acceptable (`Button.tsx`). */
export function isCodeFilePath(value: string): boolean {
  return parseCodePath(value) !== null;
}

/** Bare-prose rule: must contain a `/` to avoid linking ordinary words. */
export function isCodeFilePathStrict(value: string): boolean {
  const parsed = parseCodePath(value);
  return parsed !== null && parsed.path.includes('/');
}

function stripFencedBlocksAndComments(markdown: string): string {
  return markdown
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

const INLINE_CODE_RE = /`([^`\n]+)`/g;
// Bare-prose tokens: path-ish runs containing at least one slash, optionally
// followed by :line/:range or a #anchor. Leading ./ and ../ allowed.
const BARE_PATH_RE = /(?:\.{1,2}\/)?[\w@~][\w.@+-]*(?:\/[\w.@+-]+)+(?::\d+(?:-\d+)?|#[\w.-]+)?/g;

/**
 * Extract deduped code-path candidates from plan markdown.
 * Fenced code blocks and HTML comments are ignored. Inline code spans may
 * be bare basenames; bare prose requires a `/`. URLs never match.
 */
export function extractCandidateCodePaths(markdown: string): ParsedCodePath[] {
  const source = stripFencedBlocksAndComments(markdown);
  const seen = new Set<string>();
  const results: ParsedCodePath[] = [];

  const push = (parsed: ParsedCodePath | null) => {
    if (!parsed) return;
    const key = `${parsed.path}:${parsed.line ?? ''}:${parsed.lineEnd ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push(parsed);
  };

  let withoutInline = '';
  let lastIndex = 0;
  for (const match of source.matchAll(INLINE_CODE_RE)) {
    const content = match[1] ?? '';
    push(parseCodePath(content));
    withoutInline += source.slice(lastIndex, match.index);
    lastIndex = match.index + match[0].length;
  }
  withoutInline += source.slice(lastIndex);

  for (const match of withoutInline.matchAll(BARE_PATH_RE)) {
    const token = match[0];
    // Skip tokens inside URLs (scheme precedes the matched token).
    const before = withoutInline.slice(Math.max(0, match.index - 8), match.index);
    if (/[\w+.-]:\/\/$|:\/\/[^\s]*$/.test(before)) continue;
    if (!isCodeFilePathStrict(token)) continue;
    push(parseCodePath(token));
  }

  return results;
}

/** Unique cleaned paths for a batch exists request. */
export function candidatePathsForValidation(candidates: readonly ParsedCodePath[]): string[] {
  return [...new Set(candidates.map((candidate) => candidate.path))];
}
