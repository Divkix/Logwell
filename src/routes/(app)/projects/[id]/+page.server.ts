import { error } from '@sveltejs/kit';
import { and, count, desc, eq, gte, inArray, lt, or, type SQL, sql } from 'drizzle-orm';
import { env } from '$lib/server/config';
import { log, project } from '$lib/server/db/schema';
import { requireAuth } from '$lib/server/utils/auth-guard';
import { decodeCursor, encodeCursor } from '$lib/server/utils/cursor';
import { buildSearchQuery } from '$lib/server/utils/search';
import { LOG_LEVELS, type LogLevel } from '$lib/shared/types';
import type { PageServerLoad } from './$types';

// Constants for pagination
const DEFAULT_LIMIT = 100;
const MIN_LIMIT = 1;
const MAX_LIMIT = 500;

/**
 * Clamp a number within a range
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// TODO(RT-10): deduplicate with api/projects/[id]/logs/+server.ts parseLevelFilter
function parseLevelFilter(levelParam: string | null): LogLevel[] | null {
  if (!levelParam) return null;

  const levels = levelParam
    .split(',')
    .map((l) => l.trim().toLowerCase())
    .filter((l): l is LogLevel => LOG_LEVELS.includes(l as LogLevel));

  return levels.length > 0 ? levels : null;
}

// TODO(RT-10): deduplicate with $lib/utils/format getTimeRangeStart
function getTimeRangeStart(range: string | null): Date | null {
  if (!range) return null;

  const now = Date.now();
  switch (range) {
    case '15m':
      return new Date(now - 15 * 60 * 1000);
    case '1h':
      return new Date(now - 60 * 60 * 1000);
    case '24h':
      return new Date(now - 24 * 60 * 60 * 1000);
    case '7d':
      return new Date(now - 7 * 24 * 60 * 60 * 1000);
    default:
      return null;
  }
}

export const load: PageServerLoad = async (event) => {
  // Require session authentication
  const { user } = await requireAuth(event);

  const { db } = await import('$lib/server/db');
  const projectId = event.params.id;

  // Fetch project data - verify ownership
  const [projectData] = await db
    .select()
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.ownerId, user.id)));

  if (!projectData) {
    throw error(404, { message: 'Project not found' });
  }

  // Parse query parameters
  const url = event.url;
  const limitParam = url.searchParams.get('limit');
  const offsetParam = url.searchParams.get('offset');
  const cursorParam = url.searchParams.get('cursor');
  const levelParam = url.searchParams.get('level');
  const searchParam = url.searchParams.get('search');
  const rangeParam = url.searchParams.get('range') || '1h';

  // Parse pagination
  const limit = clamp(
    limitParam ? Number.parseInt(limitParam, 10) || DEFAULT_LIMIT : DEFAULT_LIMIT,
    MIN_LIMIT,
    MAX_LIMIT,
  );
  const offset = offsetParam ? Math.max(0, Number.parseInt(offsetParam, 10) || 0) : 0;

  // Parse filters
  const levels = parseLevelFilter(levelParam);
  const fromDate = getTimeRangeStart(rangeParam);

  // Build WHERE conditions
  const conditions: SQL[] = [eq(log.projectId, projectId)];

  // Cursor-based pagination condition
  if (cursorParam) {
    try {
      const { timestamp: cursorTimestamp, id: cursorId } = decodeCursor(cursorParam);

      // Query: WHERE (timestamp < cursor_timestamp OR (timestamp = cursor_timestamp AND id < cursor_id))
      conditions.push(
        or(
          lt(log.timestamp, cursorTimestamp),
          and(eq(log.timestamp, cursorTimestamp), lt(log.id, cursorId)),
        ) as SQL,
      );
    } catch (err) {
      // Invalid cursor - log and fall back to first page (consistent with API behavior)
      console.error('[page/logs] invalid cursor, falling back to first page:', err);
    }
  }

  // Level filter
  if (levels && levels.length > 0) {
    conditions.push(inArray(log.level, levels));
  }

  // Time range filter
  if (fromDate) {
    conditions.push(gte(log.timestamp, fromDate));
  }

  // Full-text search
  if (searchParam?.trim()) {
    const tsquery = buildSearchQuery(searchParam);
    if (tsquery) {
      conditions.push(sql`${log.search} @@ to_tsquery('english', ${tsquery})`);
    }
  }

  const whereClause = and(...conditions);

  // Get total count
  const [countResult] = await db.select({ count: count() }).from(log).where(whereClause);
  const total = countResult?.count ?? 0;

  // Fetch logs (query one extra to detect hasMore)
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
    .limit(limit + 1)
    .offset(cursorParam ? 0 : offset); // Only use offset if cursor is not provided

  // Determine if there are more logs from the overflow row
  const hasMore = logs.length > limit;

  // Slice to the requested limit before returning
  const logsToReturn = hasMore ? logs.slice(0, limit) : logs;

  // Compute next cursor if there are more logs
  const nextCursor =
    hasMore && logsToReturn.length > 0
      ? encodeCursor(logsToReturn.at(-1)!.timestamp as Date, logsToReturn.at(-1)!.id)
      : null;

  return {
    project: {
      id: projectData.id,
      name: projectData.name,
      apiKey: projectData.apiKey,
      apiKeyHash: projectData.apiKeyHash,
      retentionDays: projectData.retentionDays,
      createdAt: projectData.createdAt?.toISOString() ?? null,
      updatedAt: projectData.updatedAt?.toISOString() ?? null,
    },
    logs: logsToReturn.map((l) => ({
      ...l,
      timestamp: l.timestamp?.toISOString() ?? null,
    })),
    pagination: {
      total,
      hasMore,
      limit,
      offset,
      nextCursor,
    },
    filters: {
      levels: levels ?? [],
      search: searchParam ?? '',
      range: rangeParam,
    },
    appUrl: env.ORIGIN || event.url.origin,
  };
};
