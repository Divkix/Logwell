import { count, type SQL, sql } from "drizzle-orm";
import type { DatabaseClient } from "#lib/server/db/db.js";
import { log, project } from "#lib/server/db/schema.js";

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

  return { total, capped: isCappedLogCount(total, ceiling) };
}

export function isCappedLogCount(logCount: number, ceiling: number = LOG_COUNT_CEILING): boolean {
  return logCount >= ceiling;
}

// Fully qualified on purpose: drizzle renders `${project.id}` as a bare "id", which inside a
// subquery over "log" would silently bind to log.id instead of the outer project row.
const outerProjectId = sql`${project}.${sql.identifier(project.id.name)}`;

const logProjectId = sql`${log}.${sql.identifier(log.projectId.name)}`;

const logTimestamp = sql`${log}.${sql.identifier(log.timestamp.name)}`;

/**
 * `log.project_id = projectId`, written as a degenerate range and paired with an ORDER BY on
 * the full (project_id, timestamp) key so only idx_log_project_timestamp can serve it.
 *
 * With a plain `=` the planner treats project_id as constant, reduces the ordering to
 * `timestamp` alone, and — whenever its estimate for the value is poor (a generic plan, a
 * correlated subquery, a table whose stats have seen only one busy project) — walks the
 * single-column idx_log_timestamp across every project's rows looking for this one. For an
 * empty or quiet project that is a full index scan (measured on PG 18: 540k rows filtered for
 * an empty project, vs. an immediate stop with this form). An extra `timestamp` bound does
 * not save the plain form, which is why retention cleanup uses this one too.
 */
export function projectLogs(projectId: SQL | string): SQL {
  return sql`${logProjectId} >= ${projectId} and ${logProjectId} <= ${projectId}`;
}

const NEWEST_FIRST = sql`${logProjectId} desc, ${logTimestamp} desc`;

export const OLDEST_FIRST = sql`${logProjectId} asc, ${logTimestamp} asc`;

function cappedProjectLogCount(projectId: SQL | string, ceiling: number): SQL<number> {
  return sql<number>`(
    select count(*)::int from (
      select 1 from ${log} where ${projectLogs(projectId)} order by ${NEWEST_FIRST} limit ${ceiling}
    ) as capped
  )`.mapWith(Number);
}

function edgeLogTimestamp(projectId: SQL | string, order: SQL): SQL<Date | null> {
  return sql<Date | null>`(
    select ${logTimestamp} from ${log} where ${projectLogs(projectId)} order by ${order} limit 1
  )`.mapWith(log.timestamp);
}

/**
 * Per-project log stats as correlated subqueries for a `select` over `project`, each an
 * index range with a LIMIT. `logCount` saturates at `ceiling` (see {@link isCappedLogCount}).
 */
export function projectLogStatsColumns(ceiling: number = LOG_COUNT_CEILING) {
  return {
    logCount: cappedProjectLogCount(outerProjectId, ceiling),
    lastActivity: edgeLogTimestamp(outerProjectId, NEWEST_FIRST),
  };
}

/** Timestamp of the project's oldest stored log, for a `select` over `project`. */
export function oldestLogColumn(): SQL<Date | null> {
  return edgeLogTimestamp(outerProjectId, OLDEST_FIRST);
}

/**
 * Level distribution over a project's most recent `ceiling` logs instead of a GROUP BY over
 * every row it ever stored. Below the ceiling the counts are exact; at it, `capped` is true and
 * the counts describe the most recent `ceiling` logs only.
 */
export async function recentLevelCounts(
  db: DatabaseClient,
  projectId: string,
  ceiling: number = LOG_COUNT_CEILING,
): Promise<{ total: number; capped: boolean; levelCounts: Record<string, number> }> {
  const recent = db
    .select({ level: log.level })
    .from(log)
    .where(projectLogs(projectId))
    .orderBy(NEWEST_FIRST)
    .limit(ceiling)
    .as("recent");

  const rows = await db
    .select({ level: recent.level, count: count() })
    .from(recent)
    .groupBy(recent.level);

  const levelCounts: Record<string, number> = {};
  let total = 0;

  for (const row of rows) {
    levelCounts[row.level] = row.count;
    total += row.count;
  }

  return { total, capped: isCappedLogCount(total, ceiling), levelCounts };
}
