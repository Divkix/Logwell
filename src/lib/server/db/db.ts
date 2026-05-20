/**
 * Unified database seam — the only place in the repo that knows both drivers exist.
 *
 * Every caller uses `DatabaseClient` (a single type, not a union) and the shared
 * `getDbClient(locals)` helper. The implementation normalises driver differences
 * (e.g. raw query result shapes) so callers never think about them.
 */

import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from './schema';

/** Unified database client consumed by all business logic and routes. */
export type DatabaseClient = PostgresJsDatabase<typeof schema> | PgliteDatabase<typeof schema>;

/**
 * Normalises raw query return shapes between postgres-js (`T[]`) and PGlite
 * (`{ rows: T[] }`).
 *
 * Kept exported for existing callers that work with `.execute()` directly.
 */
export type QueryRows<T> = T[] | { rows: T[] };

export function getQueryRows<T>(result: QueryRows<T>): T[] {
  return Array.isArray(result) ? result : result.rows;
}

// Row shape for time-bucketed counts returned by raw `.execute()` queries.
export type BucketCountRow = {
  bucketIndex: number;
  count: number;
};

/**
 * Returns an injected test DB from `locals.db`, or falls back to the
 * production singleton.
 */
export async function getDbClient(locals: App.Locals): Promise<DatabaseClient> {
  if (locals.db) {
    return locals.db as DatabaseClient;
  }
  const { db } = await import('./index');
  return db;
}

/**
 * Convenience helper for route handlers that call `db.execute(sql)`.
 * Normalises the return shape to a plain array.
 */
export async function executeQuery<T>(
  db: DatabaseClient,
  query: Parameters<DatabaseClient['execute']>[0],
): Promise<T[]> {
  const raw = await db.execute(query);
  return getQueryRows(raw as QueryRows<T>);
}
