import type { PgliteDatabase } from "drizzle-orm/pglite";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "./schema";

export type DatabaseClient = PostgresJsDatabase<typeof schema> | PgliteDatabase<typeof schema>;

export type QueryRows<T> = T[] | { rows: T[] };

export function getQueryRows<T>(result: QueryRows<T>): T[] {
  return Array.isArray(result) ? result : result.rows;
}

export type BucketCountRow = {
  bucketIndex: number;
  count: number;
};

export async function getDbClient(locals: App.Locals): Promise<DatabaseClient> {
  if (locals.db) {
    return locals.db;
  }

  const { db } = await import("./index");

  return db;
}

/**
 * Client for the health probe: the dedicated single-connection `healthDb`, so a saturated app
 * pool cannot fail it. hooks.server.ts puts the shared pool on every request's `locals.db`, so
 * only a different (test-injected) client takes precedence.
 */
export async function getHealthDbClient(locals: App.Locals): Promise<DatabaseClient> {
  const { db, healthDb } = await import("./index");

  return locals.db && locals.db !== db ? locals.db : healthDb;
}
