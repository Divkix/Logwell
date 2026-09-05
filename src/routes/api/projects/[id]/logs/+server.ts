import { json } from "@sveltejs/kit";
import { getDbClient } from "$lib/server/db/db";
import { apiError } from "$lib/server/utils/api-error";
import { InvalidCursorError, queryLogs } from "$lib/server/utils/log-query";
import { isErrorResponse, requireProjectOwnership } from "$lib/server/utils/project-guard";
import { parseLevelFilter } from "$lib/shared/schemas/log";
import type { RequestEvent } from "./$types";

const DEFAULT_LIMIT = 100;
const MIN_LIMIT = 1;
const MAX_LIMIT = 500;

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
  const authResult = await requireProjectOwnership(event, event.params.id);
  if (isErrorResponse(authResult)) return authResult;

  const db = await getDbClient(event.locals);
  const projectId = event.params.id;

  const url = event.url;
  const limitParam = url.searchParams.get("limit");
  const offsetParam = url.searchParams.get("offset");
  const cursorParam = url.searchParams.get("cursor");
  const levelParam = url.searchParams.get("level");
  const searchParam = url.searchParams.get("search");
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  const limit = clamp(
    limitParam ? Number.parseInt(limitParam, 10) || DEFAULT_LIMIT : DEFAULT_LIMIT,
    MIN_LIMIT,
    MAX_LIMIT,
  );

  const offset = offsetParam ? Math.max(0, Number.parseInt(offsetParam, 10) || 0) : 0;

  const levels = parseLevelFilter(levelParam);

  const fromDate = fromParam ? new Date(fromParam) : null;
  const toDate = toParam ? new Date(toParam) : null;

  let result: Awaited<ReturnType<typeof queryLogs>>;
  try {
    result = await queryLogs(db, {
      projectId,
      levels,
      from: fromDate && !Number.isNaN(fromDate.getTime()) ? fromDate : null,
      to: toDate && !Number.isNaN(toDate.getTime()) ? toDate : null,
      search: searchParam,
      cursor: cursorParam,
      limit,
      offset,
    });
  } catch (error) {
    if (error instanceof InvalidCursorError) {
      return apiError(400, "invalid_cursor", error.message);
    }
    throw error;
  }

  return json({
    logs: result.logs.map((l) => ({
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
    total: result.total,
    total_is_capped: result.totalIsCapped,
    has_more: result.hasMore,
    nextCursor: result.nextCursor,
  });
}
