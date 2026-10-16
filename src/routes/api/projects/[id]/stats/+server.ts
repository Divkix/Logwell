import { and, count, eq, gte, lte } from "drizzle-orm";
import { log } from "#lib/server/db/schema.js";
import { apiError } from "#lib/server/utils/api-error.js";
import { requireOwnedProjectRoute } from "#lib/server/utils/owned-project.js";
import {
  InvalidTimeWindowError,
  resolveStatsWindow,
  type StatsWindow,
} from "#lib/server/utils/time-window.js";
import type { RequestEvent } from "./$types";

/**
 * GET /api/projects/[id]/stats
 *
 * Returns log statistics for a project including level distribution counts and percentages.
 * Requires session authentication and project ownership.
 *
 * Query Parameters:
 * - from: string (ISO 8601) - Start timestamp, defaults to `to` minus 90 days
 * - to: string (ISO 8601) - End timestamp, defaults to now
 *
 * The window is capped at 90 days (MAX_STATS_WINDOW_DAYS) so the aggregate never scans a
 * project's whole retention.
 *
 * Response:
 * {
 *   from: string,  // effective window start (ISO 8601)
 *   to: string,    // effective window end (ISO 8601)
 *   totalLogs: number,
 *   levelCounts: {
 *     debug?: number,
 *     info?: number,
 *     warn?: number,
 *     error?: number,
 *     fatal?: number
 *   },
 *   levelPercentages: {
 *     debug?: number,
 *     info?: number,
 *     warn?: number,
 *     error?: number,
 *     fatal?: number
 *   }
 * }
 *
 * Error responses:
 * - 400 invalid_date: from/to is not a valid timestamp
 * - 400 invalid_range: from is after to, or the window exceeds 90 days
 * - 303 redirect to /login: Not authenticated
 * - 404 not_found: Project does not exist or not owned by user
 */
export async function GET(event: RequestEvent): Promise<Response> {
  const authResult = await requireOwnedProjectRoute(event, event.params.id);

  if (authResult instanceof Response) return authResult;

  const { db } = authResult;
  const projectId = event.params.id;

  let window: StatsWindow;

  try {
    window = resolveStatsWindow(
      event.url.searchParams.get("from"),
      event.url.searchParams.get("to"),
    );
  } catch (error) {
    if (error instanceof InvalidTimeWindowError) {
      return apiError(400, error.code, error.message);
    }

    throw error;
  }

  const whereClause = and(
    eq(log.projectId, projectId),
    gte(log.timestamp, window.from),
    lte(log.timestamp, window.to),
  );

  const levelCounts = await db
    .select({
      level: log.level,
      count: count(),
    })
    .from(log)
    .where(whereClause)
    .groupBy(log.level);

  const levelCountsObj: Record<string, number> = {};
  let totalLogs = 0;

  for (const { level, count: levelCount } of levelCounts) {
    if (level) {
      levelCountsObj[level] = levelCount;
      totalLogs += levelCount;
    }
  }

  const levelPercentagesObj: Record<string, number> = {};

  if (totalLogs > 0) {
    for (const [level, levelCount] of Object.entries(levelCountsObj)) {
      levelPercentagesObj[level] = Number(((levelCount / totalLogs) * 100).toFixed(2));
    }
  }

  return Response.json({
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    totalLogs,
    levelCounts: levelCountsObj,
    levelPercentages: levelPercentagesObj,
  });
}
