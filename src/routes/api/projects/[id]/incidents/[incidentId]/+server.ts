import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '$lib/server/db/schema';
import { incident, log } from '$lib/server/db/schema';
import { getIncidentStatus } from '$lib/server/utils/incidents';
import { isErrorResponse, requireProjectOwnership } from '$lib/server/utils/project-guard';
import type { RequestEvent } from './$types';

type DatabaseClient = PostgresJsDatabase<typeof schema> | PgliteDatabase<typeof schema>;

async function getDbClient(locals: App.Locals): Promise<DatabaseClient> {
  if (locals.db) return locals.db as DatabaseClient;
  const { db } = await import('$lib/server/db');
  return db;
}

/**
 * GET /api/projects/[id]/incidents/[incidentId]
 */
export async function GET(event: RequestEvent): Promise<Response> {
  const authResult = await requireProjectOwnership(event, event.params.id);
  if (isErrorResponse(authResult)) return authResult;

  const db = await getDbClient(event.locals);
  const projectId = event.params.id;
  const incidentId = event.params.incidentId;

  const [incidentRow] = await db
    .select()
    .from(incident)
    .where(and(eq(incident.projectId, projectId), eq(incident.id, incidentId)));

  if (!incidentRow) {
    return json({ error: 'not_found', message: 'Incident not found' }, { status: 404 });
  }

  const incidentLogs = await db
    .select({
      sourceFile: log.sourceFile,
      lineNumber: log.lineNumber,
      requestId: log.requestId,
      traceId: log.traceId,
    })
    .from(log)
    .where(and(eq(log.projectId, projectId), eq(log.incidentId, incidentId)));

  const sourceFrequency = new Map<string, { sourceFile: string | null; lineNumber: number | null; count: number }>();
  const requestCounts = new Map<string, number>();
  const traceCounts = new Map<string, number>();

  for (const entry of incidentLogs) {
    const sourceKey = `${entry.sourceFile ?? 'unknown'}:${entry.lineNumber ?? 0}`;
    const current = sourceFrequency.get(sourceKey);
    sourceFrequency.set(sourceKey, {
      sourceFile: entry.sourceFile,
      lineNumber: entry.lineNumber,
      count: (current?.count ?? 0) + 1,
    });

    if (entry.requestId) {
      requestCounts.set(entry.requestId, (requestCounts.get(entry.requestId) ?? 0) + 1);
    }
    if (entry.traceId) {
      traceCounts.set(entry.traceId, (traceCounts.get(entry.traceId) ?? 0) + 1);
    }
  }

  const rootCauseCandidates = [...sourceFrequency.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  const topRequestIds = [...requestCounts.entries()]
    .map(([requestId, count]) => ({ requestId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  const topTraceIds = [...traceCounts.entries()]
    .map(([traceId, count]) => ({ traceId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return json({
    id: incidentRow.id,
    projectId: incidentRow.projectId,
    fingerprint: incidentRow.fingerprint,
    title: incidentRow.title,
    normalizedMessage: incidentRow.normalizedMessage,
    serviceName: incidentRow.serviceName,
    sourceFile: incidentRow.sourceFile,
    lineNumber: incidentRow.lineNumber,
    highestLevel: incidentRow.highestLevel,
    firstSeen: incidentRow.firstSeen.toISOString(),
    lastSeen: incidentRow.lastSeen.toISOString(),
    totalEvents: incidentRow.totalEvents,
    reopenCount: incidentRow.reopenCount,
    status: getIncidentStatus(incidentRow.lastSeen),
    rootCauseCandidates,
    correlations: {
      topRequestIds,
      topTraceIds,
    },
  });
}
