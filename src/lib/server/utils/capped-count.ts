import { count, type SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { log } from "$lib/server/db/schema";

/**
 * Maximum number of matching rows the capped count will scan.
 * Postgres stops after this many rows, bounding the cost of the COUNT query.
 * The UI renders "N+" when `capped` is true, signalling the real count is ≥ this value.
 */
export const LOG_COUNT_CEILING = 10_000;

/**
 * Run a bounded COUNT against the log table.
 *
 * Instead of `SELECT count(*) FROM log WHERE …` (which scans all matching rows),
 * this issues:
 *   SELECT count(*) FROM (SELECT 1 FROM log WHERE <whereClause> LIMIT 10000) capped
 *
 * Postgres stops scanning after LOG_COUNT_CEILING matching rows, keeping the
 * query cost proportional to the ceiling rather than the full result set size.
 *
 * @param db          - Drizzle database client (PgDatabase or PgliteDatabase)
 * @param whereClause - Pre-built WHERE clause (from `and(...)`)
 * @returns `{ total, capped }` where `capped` is true when the real count ≥ LOG_COUNT_CEILING
 */
export async function cappedLogCount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: PgDatabase<any, any, any>,
  whereClause: SQL | undefined,
): Promise<{ total: number; capped: boolean }> {
  const cappedSubquery = db
    .select({ one: sql<number>`1` })
    .from(log)
    .where(whereClause)
    .limit(LOG_COUNT_CEILING)
    .as("capped");

  const [row] = await db.select({ c: count() }).from(cappedSubquery);
  const total = row?.c ?? 0;
  return { total, capped: total >= LOG_COUNT_CEILING };
}
