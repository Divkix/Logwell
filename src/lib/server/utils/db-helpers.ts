/**
 * Shared database helper types and utilities for handling Drizzle raw query results.
 *
 * Drizzle's `db.execute()` returns `T[]` in production (postgres-js) but `{ rows: T[] }`
 * in tests (PGlite). These helpers normalize both shapes.
 */

export type BucketCountRow = {
  bucketIndex: number;
  count: number;
};

export type QueryRows<T> = T[] | { rows: T[] };

export function getQueryRows<T>(result: QueryRows<T>): T[] {
  return Array.isArray(result) ? result : result.rows;
}
