import { json } from '@sveltejs/kit';
import { and, eq, sql } from 'drizzle-orm';
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

  const whereClause = and(eq(log.projectId, projectId), eq(log.incidentId, incidentId));

  // Aggregate source file frequencies in SQL
  const sourceResults = await db.execute(sql`
    SELECT ${log.sourceFile} AS source_file, ${log.lineNumber} AS line_number, count(*)::int AS count
    FROM ${log}
    WHERE ${whereClause}
    GROUP BY ${log.sourceFile}, ${log.lineNumber}
    ORDER BY count DESC
    LIMIT 5
  `);

  // Aggregate request IDs in SQL
  const requestResults = await db.execute(sql`
    SELECT ${log.requestId} AS request_id, count(*)::int AS count
    FROM ${log}
    WHERE ${whereClause} AND ${log.requestId} IS NOT NULL
    GROUP BY ${log.requestId}
    ORDER BY count DESC
    LIMIT 10
  `);

  // Aggregate trace IDs in SQL
  const traceResults = await db.execute(sql`
    SELECT ${log.traceId} AS trace_id, count(*)::int AS count
    FROM ${log}
    WHERE ${whereClause} AND ${log.traceId} IS NOT NULL
    GROUP BY ${log.traceId}
    ORDER BY count DESC
    LIMIT 10
  `);

  // Handle both PGlite Results and postgres-js RowList
  const sourceRows = 'rows' in sourceResults ? sourceResults.rows : Array.from(sourceResults);
  const requestRows = 'rows' in requestResults ? requestResults.rows : Array.from(requestResults);
  const traceRows = 'rows' in traceResults ? traceResults.rows : Array.from(traceResults);

  const rootCauseCandidates = sourceRows.map((row) => ({
    sourceFile: row.source_file as string | null,
    lineNumber: row.line_number as number | null,
    count: row.count as number,
  }));

  const topRequestIds = requestRows.map((row) => ({
    requestId: row.request_id as string,
    count: row.count as number,
  }));

  const topTraceIds = traceRows.map((row) => ({
    traceId: row.trace_id as string,
    count: row.count as number,
  }));

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
