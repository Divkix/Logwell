import { error } from '@sveltejs/kit';
import { and, count, desc, eq, gte, lt, or, type SQL } from 'drizzle-orm';
import { incident, project } from '$lib/server/db/schema';
import { INCIDENT_CONFIG } from '$lib/server/config';
import { decodeCursor, encodeCursor } from '$lib/server/utils/cursor';
import { getIncidentStatus } from '$lib/server/utils/incidents';
import { requireAuth } from '$lib/server/utils/auth-guard';
import { INCIDENT_RANGES, INCIDENT_STATUSES, type IncidentRange, type IncidentStatus } from '$lib/shared/types';
import { getTimeRangeStart } from '$lib/utils/format';
import type { PageServerLoad } from './$types';

const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 20;
const MAX_LIMIT = 200;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export const load: PageServerLoad = async (event) => {
  const { user } = await requireAuth(event);
  const { db } = await import('$lib/server/db');
  const projectId = event.params.id;

  const [projectData] = await db
    .select()
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.ownerId, user.id)));

  if (!projectData) {
    throw error(404, { message: 'Project not found' });
  }

  const params = event.url.searchParams;
  const limit = clamp(
    params.get('limit') ? Number.parseInt(params.get('limit') || '', 10) || DEFAULT_LIMIT : DEFAULT_LIMIT,
    MIN_LIMIT,
    MAX_LIMIT,
  );
  const cursorParam = params.get('cursor');
  const statusParam = params.get('status') || 'open';
  const status: IncidentStatus = INCIDENT_STATUSES.includes(statusParam as IncidentStatus)
    ? (statusParam as IncidentStatus)
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
    } catch {
      // Ignore invalid cursor in page load; fallback to first page.
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
      ? encodeCursor(incidents[incidents.length - 1].lastSeen as Date, incidents[incidents.length - 1].id)
      : null;

  return {
    project: {
      id: projectData.id,
      name: projectData.name,
    },
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
    pagination: {
      total,
      hasMore,
      nextCursor,
      limit,
    },
    filters: {
      status,
      range,
      selectedIncidentId: params.get('incident'),
    },
  };
};
