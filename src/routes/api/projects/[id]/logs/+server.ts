import { json } from "@sveltejs/kit";
import { and, desc, eq, gte, inArray, lte, type SQL, sql } from "drizzle-orm";
import { getDbClient } from "$lib/server/db/db";
import { log } from "$lib/server/db/schema";
import { apiError } from "$lib/server/utils/api-error";
import { cappedLogCount } from "$lib/server/utils/capped-count";
import {
  decodeCursor,
  encodeCursor,
  cursorRowLessThan,
  microsColumn,
} from "$lib/server/utils/cursor";
import { isErrorResponse, requireProjectOwnership } from "$lib/server/utils/project-guard";
import { buildSearchQuery } from "$lib/server/utils/search";
import { parseLevelFilter } from "$lib/shared/schemas/log";
import type { RequestEvent } from "./$types";

// Constants for pagination limits
const DEFAULT_LIMIT = 100;
const MIN_LIMIT = 1;
const MAX_LIMIT = 500;

/**
 * Clamp a number within a range
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * GET /api/projects/[id]/logs
 *
 * Query logs with pagination, filtering, and full-text search.
 * Requires session authentication and project ownership.
 *
 * Query Parameters:
 * - limit: number (100-500, default 100) - Logs per page
 * - offset: number (default 0) - Pagination offset (deprecated, use cursor)
 * - cursor: string - Cursor for pagination (preferred over offset)
 * - level: string - Filter by level (comma-separated, e.g., "error,fatal")
 * - search: string - Full-text search query
 * - from: string (ISO 8601) - Start timestamp filter
 * - to: string (ISO 8601) - End timestamp filter
 *
 * Response:
 * {
 *   logs: Array<Log>,
 *   total: number,
 *   has_more: boolean,
 *   nextCursor?: string
 * }
 *
 * Error responses:
 * - 303 redirect to /login: Not authenticated
 * - 400 invalid_cursor: Cursor is malformed
 * - 404 not_found: Project does not exist or not owned by user
 */
export async function GET(event: RequestEvent): Promise<Response> {
  // Require authentication and project ownership
  const authResult = await requireProjectOwnership(event, event.params.id);
  if (isErrorResponse(authResult)) return authResult;

  const db = await getDbClient(event.locals);
  const projectId = event.params.id;

  // Parse query parameters
  const url = event.url;
  const limitParam = url.searchParams.get("limit");
  const offsetParam = url.searchParams.get("offset");
  const cursorParam = url.searchParams.get("cursor");
  const levelParam = url.searchParams.get("level");
  const searchParam = url.searchParams.get("search");
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  // Parse and clamp limit
  const limit = clamp(
    limitParam ? Number.parseInt(limitParam, 10) || DEFAULT_LIMIT : DEFAULT_LIMIT,
    MIN_LIMIT,
    MAX_LIMIT,
  );

  // Parse offset (fallback for backward compatibility)
  const offset = offsetParam ? Math.max(0, Number.parseInt(offsetParam, 10) || 0) : 0;

  // Parse level filter
  const levels = parseLevelFilter(levelParam);

  // Parse time range
  const fromDate = fromParam ? new Date(fromParam) : null;
  const toDate = toParam ? new Date(toParam) : null;

  // Build WHERE conditions
  const conditions: SQL[] = [eq(log.projectId, projectId)];

  // Cursor-based pagination condition
  if (cursorParam) {
    try {
      const { micros: cursorMicros, id: cursorId } = decodeCursor(cursorParam);

      // Row-value comparison: (timestamp, id) < (cursorTimestamp, cursorId).
      // Comparing the full row (instead of a millisecond-truncated timestamp
      // with an id tie-break) means rows that share the cursor's millisecond
      // are tie-broken on id and never skipped.
      conditions.push(cursorRowLessThan(log.timestamp, log.id, cursorMicros, cursorId));
    } catch (error) {
      return apiError(
        400,
        "invalid_cursor",
        error instanceof Error ? error.message : "Invalid cursor",
      );
    }
  }

  // Level filter
  if (levels && levels.length > 0) {
    conditions.push(inArray(log.level, levels));
  }

  // Time range filters
  if (fromDate && !Number.isNaN(fromDate.getTime())) {
    conditions.push(gte(log.timestamp, fromDate));
  }
  if (toDate && !Number.isNaN(toDate.getTime())) {
    conditions.push(lte(log.timestamp, toDate));
  }

  // Full-text search
  if (searchParam?.trim()) {
    const tsquery = buildSearchQuery(searchParam);
    if (tsquery) {
      conditions.push(sql`${log.search} @@ to_tsquery('english', ${tsquery})`);
    }
  }

  const whereClause = and(...conditions);

  // Skip COUNT(*) when a cursor is provided (subsequent pages); saves a DB round-trip.
  // On the first page use a bounded count (capped at LOG_COUNT_CEILING) so the query
  // stops scanning after that many rows even for expensive predicates (e.g. full-text search).
  const countResult = cursorParam ? undefined : await cappedLogCount(db, whereClause);
  const total = countResult?.total;
  const totalIsCapped = countResult?.capped ?? false;

  // Fetch logs with pagination (query one extra to detect hasMore).
  // `micros` carries the row's exact microsecond timestamp so the cursor can
  // tie-break rows that share the same millisecond.
  const logs = await db
    .select({
      id: log.id,
      projectId: log.projectId,
      incidentId: log.incidentId,
      fingerprint: log.fingerprint,
      serviceName: log.serviceName,
      level: log.level,
      message: log.message,
      metadata: log.metadata,
      sourceFile: log.sourceFile,
      lineNumber: log.lineNumber,
      requestId: log.requestId,
      userId: log.userId,
      ipAddress: log.ipAddress,
      timestamp: log.timestamp,
      micros: microsColumn(log.timestamp),
    })
    .from(log)
    .where(whereClause)
    .orderBy(desc(log.timestamp), desc(log.id))
    .limit(limit + 1)
    .offset(cursorParam ? 0 : offset); // Only use offset if cursor is not provided

  // Determine if there are more logs from the overflow row
  const hasMore = logs.length > limit;

  // Slice to the requested limit before returning
  const logsToReturn = hasMore ? logs.slice(0, limit) : logs;

  // Compute next cursor if there are more logs
  const nextCursor =
    hasMore && logsToReturn.length > 0
      ? encodeCursor(Math.round(logsToReturn.at(-1)!.micros), logsToReturn.at(-1)!.id)
      : null;

  return json({
    logs: logsToReturn.map((l) => ({
      id: l.id,
      projectId: l.projectId,
      incidentId: l.incidentId,
      fingerprint: l.fingerprint,
      serviceName: l.serviceName,
      level: l.level,
      message: l.message,
      metadata: l.metadata,
      sourceFile: l.sourceFile,
      lineNumber: l.lineNumber,
      requestId: l.requestId,
      userId: l.userId,
      ipAddress: l.ipAddress,
      timestamp: l.timestamp?.toISOString(),
    })),
    total: total ?? null,
    total_is_capped: totalIsCapped,
    has_more: hasMore,
    nextCursor,
  });
}
