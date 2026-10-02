export interface FilePlanQuery {
  files: string[];
  text: string;
  error?: string;
}

/** File filters intersect; remaining text keeps the dashboard's substring semantics. */
export function parseFilePlanQuery(query: string): FilePlanQuery {
  const files: string[] = [];
  const text: string[] = [];
  for (const match of query.matchAll(/file:"[^"]*"|"[^"]*"|\S+/gi)) {
    const token = match[0];
    if (!/^file:/i.test(token)) {
      text.push(token);
      continue;
    }
    const raw = token.slice(5);
    if (!raw || (raw.includes('"') && !(raw.startsWith('"') && raw.endsWith('"')))) {
      return {
        files,
        text: text.join(' '),
        error: 'Use file:src/auth.ts or file:"path with spaces.ts".',
      };
    }
    const path = (raw.startsWith('"') ? raw.slice(1, -1) : raw).trim();
    if (!path) return { files, text: text.join(' '), error: 'Add a file path after file:.' };
    if (path.length > 1024 || path.includes('\0'))
      return {
        files,
        text: text.join(' '),
        error: 'File paths must be at most 1024 characters and contain no NUL.',
      };
    files.push(path);
    if (new Set(files).size > 8)
      return { files, text: text.join(' '), error: 'Use at most 8 file filters.' };
  }
  return { files: [...new Set(files)], text: text.join(' ') };
}

/** Safe navigation syntax for paths containing spaces; quotes are rejected by path parsers. */
export function filePlanSearchQuery(path: string): string {
  return `file:"${path}"`;
}
