import { count, type SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { DatabaseClient } from "$lib/server/db/db";
import { log } from "$lib/server/db/schema";

export const LOG_COUNT_CEILING = 10_000;

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
