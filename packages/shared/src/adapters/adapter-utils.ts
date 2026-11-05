/** Small helpers shared by several adapters. */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The filesystem error code of a thrown value, if it has one (`ENOENT`, `EACCES`, ...). */
export function errorCode(err: unknown): string | undefined {
  if (!isRecord(err)) return undefined;
  const code = err.code;
  return typeof code === 'string' ? code : undefined;
}

/** True when the error means the source is gone, not that reading it failed. */
export function isMissingSourceError(err: unknown): boolean {
  const code = errorCode(err);
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * Adapter `parse` catch handler: a deleted source genuinely has no plans, so
 * return none; any other failure (permissions, a locked or corrupt database, a
 * half-written file) propagates so the plan service keeps the plans it had.
 */
export function noPlansIfMissing<T>(err: unknown, empty: T): T {
  if (isMissingSourceError(err)) return empty;
  throw err;
}

export type SqliteQuery = <Row>(sql: string) => Row[];

/** Open a SQLite file read-only under Bun or Node, run `read`, and close it. */
export async function withReadonlySqlite<T>(
  filePath: string,
  read: (query: SqliteQuery) => T,
): Promise<T> {
  if (typeof Bun !== 'undefined') {
    const { Database } = await import('bun:sqlite');
    const database = new Database(filePath, { readonly: true, create: false });
    try {
      return read(<Row>(sql: string) => database.query(sql).all() as Row[]);
    } finally {
      database.close();
    }
  }
  const { default: Database } = await import('better-sqlite3');
  const database = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    return read(<Row>(sql: string) => database.prepare(sql).all() as Row[]);
  } finally {
    database.close();
  }
}
