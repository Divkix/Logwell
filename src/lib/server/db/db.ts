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
    return locals.db as DatabaseClient;
  }
  const { db } = await import("./index");
  return db;
}
