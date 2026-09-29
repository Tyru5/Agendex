/** Match receipt/source-link semantics: explicit ./ and ../ start at the plan directory. */
export function filePlanQueryPath(
  path: string,
  plan: { workspace?: string; filePath?: string },
): string {
  const clean = path.replace(/\\/g, '/');
  if (!/^\.{1,2}\//.test(clean)) return clean;
  const workspace = normalizeAbsolute(plan.workspace ?? '');
  const source = normalizeAbsolute(plan.filePath ?? '');
  if (!workspace || !source) return clean;
  const base = source.slice(0, source.lastIndexOf('/'));
  // Agent-global plan stores are outside the workspace; they are not source-path bases.
  if (workspace !== '/' && base !== workspace && !base.startsWith(`${workspace}/`)) return clean;
  const absolute = normalizeAbsolute(`${base}/${clean}`);
  if (!absolute) return clean;
  // Within-workspace queries stay portable. Local receipts also allow explicit
  // sibling-package references inside the containing repository; retain their
  // absolute target so the local backend can apply that repository boundary.
  return workspace === '/'
    ? absolute.slice(1)
    : absolute.startsWith(`${workspace}/`)
      ? absolute.slice(workspace.length + 1)
      : absolute;
}

function normalizeAbsolute(raw: string): string | null {
  let path = raw.trim().replace(/\\/g, '/');
  if (!path.startsWith('/') && !/^[A-Za-z]:\//.test(path)) return null;
  const prefix = path.startsWith('/') ? '/' : `${path[0]?.toUpperCase()}:/`;
  path = path.slice(prefix.length);
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return prefix + parts.join('/');
}
