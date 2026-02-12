import { json } from '@sveltejs/kit';
import { and, count, desc, eq, gte, inArray, lt, lte, or, type SQL, sql } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '$lib/server/db/schema';
import { log } from '$lib/server/db/schema';
import { decodeCursor, encodeCursor } from '$lib/server/utils/cursor';
import { isErrorResponse, requireProjectOwnership } from '$lib/server/utils/project-guard';
import { LOG_LEVELS, type LogLevel } from '$lib/shared/types';
import type { RequestEvent } from './$types';

type DatabaseClient = PostgresJsDatabase<typeof schema> | PgliteDatabase<typeof schema>;

// Constants for pagination limits
const DEFAULT_LIMIT = 100;
const MIN_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * Helper to get database client from locals or production db
 * Supports test injection via locals.db
 */
async function getDbClient(locals: App.Locals): Promise<DatabaseClient> {
  if (locals.db) {
    return locals.db as DatabaseClient;
  }
  const { db } = await import('$lib/server/db');
  return db;
}

/**
 * Clamp a number within a range
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Parse and validate level filter from query string
 * Returns array of valid log levels or null if no filter
 */
function parseLevelFilter(levelParam: string | null): LogLevel[] | null {
  if (!levelParam) return null;

  const levels = levelParam
    .split(',')
    .map((l) => l.trim().toLowerCase())
    .filter((l): l is LogLevel => LOG_LEVELS.includes(l as LogLevel));

  return levels.length > 0 ? levels : null;
}

/**
 * Build the full-text search tsquery from user input
 * Converts space-separated terms to PostgreSQL tsquery format
 */
function buildSearchQuery(searchTerm: string): string {
  return searchTerm
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => term.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(Boolean)
    .join(' & ');
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
  const limitParam = url.searchParams.get('limit');
  const offsetParam = url.searchParams.get('offset');
  const cursorParam = url.searchParams.get('cursor');
  const levelParam = url.searchParams.get('level');
  const searchParam = url.searchParams.get('search');
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');

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
      const { timestamp: cursorTimestamp, id: cursorId } = decodeCursor(cursorParam);

      // Query: WHERE (timestamp < cursor_timestamp OR (timestamp = cursor_timestamp AND id < cursor_id))
      // This ensures we get logs older than the cursor position
      conditions.push(
        or(
          lt(log.timestamp, cursorTimestamp),
          and(eq(log.timestamp, cursorTimestamp), lt(log.id, cursorId)),
        ) as SQL,
      );
    } catch (error) {
      return json(
        {
          code: 'invalid_cursor',
          message: error instanceof Error ? error.message : 'Invalid cursor',
        },
        { status: 400 },
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

  // Get total count (for pagination info)
  const [countResult] = await db.select({ count: count() }).from(log).where(whereClause);

  const total = countResult?.count ?? 0;

  // Fetch logs with pagination
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
    })
    .from(log)
    .where(whereClause)
    .orderBy(desc(log.timestamp), desc(log.id))
    .limit(limit)
    .offset(cursorParam ? 0 : offset); // Only use offset if cursor is not provided

  // Determine if there are more logs
  const hasMore = cursorParam ? logs.length === limit : offset + logs.length < total;

  // Compute next cursor if there are more logs
  const nextCursor =
    hasMore && logs.length > 0
      ? encodeCursor(logs[logs.length - 1].timestamp as Date, logs[logs.length - 1].id)
      : null;

  return json({
    logs: logs.map((l) => ({
      ...l,
      timestamp: l.timestamp?.toISOString(),
    })),
    total,
    has_more: hasMore,
    nextCursor,
  });
}
