import { count, type SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { DatabaseClient } from "$lib/server/db/db";
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
 * @param db          - Drizzle database client (Postgres.js or PGlite)
 * @param whereClause - Pre-built WHERE clause (from `and(...)`)
 * @param ceiling     - Scan ceiling (defaults to LOG_COUNT_CEILING; overridable for tests)
 * @returns `{ total, capped }` where `capped` is true when the real count ≥ ceiling
 */
export async function cappedLogCount(
  db: DatabaseClient,
  whereClause: SQL | undefined,
  ceiling: number = LOG_COUNT_CEILING,
): Promise<{ total: number; capped: boolean }> {
  const cappedSubquery = db
    .select({ one: sql<number>`1` })
    .from(log)
    .where(whereClause)
    .limit(ceiling)
    .as("capped");

  const [row] = await db.select({ c: count() }).from(cappedSubquery);
  const total = row?.c ?? 0;
  return { total, capped: total >= ceiling };
}
