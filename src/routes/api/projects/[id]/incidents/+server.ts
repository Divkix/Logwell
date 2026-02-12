import { json } from '@sveltejs/kit';
import { and, count, desc, eq, gte, lt, or, type SQL } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { INCIDENT_CONFIG } from '$lib/server/config';
import type * as schema from '$lib/server/db/schema';
import { incident } from '$lib/server/db/schema';
import { decodeCursor, encodeCursor } from '$lib/server/utils/cursor';
import { getIncidentStatus } from '$lib/server/utils/incidents';
import { isErrorResponse, requireProjectOwnership } from '$lib/server/utils/project-guard';
import { INCIDENT_RANGES, INCIDENT_STATUSES, type IncidentRange } from '$lib/shared/types';
import { getTimeRangeStart } from '$lib/utils/format';
import type { RequestEvent } from './$types';

type DatabaseClient = PostgresJsDatabase<typeof schema> | PgliteDatabase<typeof schema>;

const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 20;
const MAX_LIMIT = 200;

async function getDbClient(locals: App.Locals): Promise<DatabaseClient> {
  if (locals.db) return locals.db as DatabaseClient;
  const { db } = await import('$lib/server/db');
  return db;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * GET /api/projects/[id]/incidents
 */
export async function GET(event: RequestEvent): Promise<Response> {
  const authResult = await requireProjectOwnership(event, event.params.id);
  if (isErrorResponse(authResult)) return authResult;

  const db = await getDbClient(event.locals);
  const projectId = event.params.id;

  const params = event.url.searchParams;
  const limit = clamp(
    params.get('limit')
      ? Number.parseInt(params.get('limit') || '', 10) || DEFAULT_LIMIT
      : DEFAULT_LIMIT,
    MIN_LIMIT,
    MAX_LIMIT,
  );
  const cursorParam = params.get('cursor');
  const statusParam = params.get('status') || 'open';
  const status = INCIDENT_STATUSES.includes(statusParam as (typeof INCIDENT_STATUSES)[number])
    ? (statusParam as (typeof INCIDENT_STATUSES)[number])
    : 'open';

  const rangeParam = params.get('range') || '24h';
  const range: IncidentRange = INCIDENT_RANGES.includes(rangeParam as IncidentRange)
    ? (rangeParam as IncidentRange)
    : '24h';
  const rangeStart = getTimeRangeStart(range);
  const resolvedThreshold = new Date(Date.now() - INCIDENT_CONFIG.AUTO_RESOLVE_MINUTES * 60 * 1000);

  const conditions: SQL[] = [eq(incident.projectId, projectId), gte(incident.lastSeen, rangeStart)];

  if (status === 'open') {
    conditions.push(gte(incident.lastSeen, resolvedThreshold));
  } else if (status === 'resolved') {
    conditions.push(lt(incident.lastSeen, resolvedThreshold));
  }

  if (cursorParam) {
    try {
      const { timestamp: cursorTimestamp, id: cursorId } = decodeCursor(cursorParam);
      conditions.push(
        or(
          lt(incident.lastSeen, cursorTimestamp),
          and(eq(incident.lastSeen, cursorTimestamp), lt(incident.id, cursorId)),
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

  const whereClause = and(...conditions);
  const [countResult] = await db.select({ count: count() }).from(incident).where(whereClause);
  const total = countResult?.count ?? 0;

  const incidents = await db
    .select()
    .from(incident)
    .where(whereClause)
    .orderBy(desc(incident.lastSeen), desc(incident.id))
    .limit(limit);

  const hasMore = incidents.length === limit;
  const nextCursor =
    hasMore && incidents.length > 0
      ? encodeCursor(
          incidents[incidents.length - 1].lastSeen as Date,
          incidents[incidents.length - 1].id,
        )
      : null;

  return json({
    incidents: incidents.map((i) => ({
      id: i.id,
      projectId: i.projectId,
      fingerprint: i.fingerprint,
      title: i.title,
      normalizedMessage: i.normalizedMessage,
      serviceName: i.serviceName,
      sourceFile: i.sourceFile,
      lineNumber: i.lineNumber,
      highestLevel: i.highestLevel,
      firstSeen: i.firstSeen.toISOString(),
      lastSeen: i.lastSeen.toISOString(),
      totalEvents: i.totalEvents,
      reopenCount: i.reopenCount,
      status: getIncidentStatus(i.lastSeen),
    })),
    total,
    has_more: hasMore,
    nextCursor,
    filters: { status, range },
  });
}
