import { json } from '@sveltejs/kit';
import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm';
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

  const sourceCountExpression = sql<number>`count(*)::int`;
  const requestCountExpression = sql<number>`count(*)::int`;
  const traceCountExpression = sql<number>`count(*)::int`;
  const incidentLogCondition = and(eq(log.projectId, projectId), eq(log.incidentId, incidentId));

  const rootCauseCandidates = await db
    .select({
      sourceFile: log.sourceFile,
      lineNumber: log.lineNumber,
      count: sourceCountExpression,
    })
    .from(log)
    .where(incidentLogCondition)
    .groupBy(log.sourceFile, log.lineNumber)
    .orderBy(desc(sourceCountExpression), asc(log.sourceFile), asc(log.lineNumber))
    .limit(5);

  const topRequestIdRows = await db
    .select({
      requestId: log.requestId,
      count: requestCountExpression,
    })
    .from(log)
    .where(and(incidentLogCondition, isNotNull(log.requestId)))
    .groupBy(log.requestId)
    .orderBy(desc(requestCountExpression), asc(log.requestId))
    .limit(10);

  const topTraceIdRows = await db
    .select({
      traceId: log.traceId,
      count: traceCountExpression,
    })
    .from(log)
    .where(and(incidentLogCondition, isNotNull(log.traceId)))
    .groupBy(log.traceId)
    .orderBy(desc(traceCountExpression), asc(log.traceId))
    .limit(10);

  const topRequestIds = topRequestIdRows.flatMap((row) =>
    row.requestId ? [{ requestId: row.requestId, count: Number(row.count ?? 0) }] : [],
  );
  const topTraceIds = topTraceIdRows.flatMap((row) =>
    row.traceId ? [{ traceId: row.traceId, count: Number(row.count ?? 0) }] : [],
  );

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
    status: getIncidentStatus(incidentRow.lastSeen),
    rootCauseCandidates: rootCauseCandidates.map((candidate) => ({
      sourceFile: candidate.sourceFile,
      lineNumber: candidate.lineNumber,
      count: Number(candidate.count ?? 0),
    })),
    correlations: {
      topRequestIds,
      topTraceIds,
    },
  });
}
