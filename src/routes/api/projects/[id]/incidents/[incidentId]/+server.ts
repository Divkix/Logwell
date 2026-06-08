import { json } from "@sveltejs/kit";
import { and, eq, sql } from "drizzle-orm";
import { getDbClient, getQueryRows } from "$lib/server/db/db";
import { incident, log } from "$lib/server/db/schema";
import { apiError } from "$lib/server/utils/api-error";
import { getIncidentStatus } from "$lib/server/utils/incidents";
import { isErrorResponse, requireProjectOwnership } from "$lib/server/utils/project-guard";
import type { RequestEvent } from "./$types";

type SourceFrequencyRow = {
  sourceFile: string | null;
  lineNumber: number | null;
  count: number;
};

type RequestFrequencyRow = {
  requestId: string;
  count: number;
};

type TraceFrequencyRow = {
  traceId: string;
  count: number;
};

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
    return apiError(404, "not_found", "Incident not found");
  }

  const logWhereClause = and(eq(log.projectId, projectId), eq(log.incidentId, incidentId));

  const [sourceResult, requestResult, traceResult] = await Promise.all([
    db.execute(sql<SourceFrequencyRow>`
      select
        ${log.sourceFile} as "sourceFile",
        ${log.lineNumber} as "lineNumber",
        count(*)::int as "count"
      from ${log}
      where ${logWhereClause}
      group by ${log.sourceFile}, ${log.lineNumber}
      order by "count" desc, ${log.sourceFile} asc nulls last, ${log.lineNumber} asc nulls last
      limit 5
    `),
    db.execute(sql<RequestFrequencyRow>`
      select
        ${log.requestId} as "requestId",
        count(*)::int as "count"
      from ${log}
      where ${logWhereClause} and ${log.requestId} is not null and ${log.requestId} <> ''
      group by ${log.requestId}
      order by "count" desc, ${log.requestId} asc
      limit 10
    `),
    db.execute(sql<TraceFrequencyRow>`
      select
        ${log.traceId} as "traceId",
        count(*)::int as "count"
      from ${log}
      where ${logWhereClause} and ${log.traceId} is not null and ${log.traceId} <> ''
      group by ${log.traceId}
      order by "count" desc, ${log.traceId} asc
      limit 10
    `),
  ]);

  const rootCauseCandidates = getQueryRows(sourceResult).map((row) => ({
    sourceFile: row.sourceFile,
    lineNumber: row.lineNumber,
    count: Number(row.count),
  }));
  const topRequestIds = getQueryRows(requestResult).map((row) => ({
    requestId: row.requestId,
    count: Number(row.count),
  }));
  const topTraceIds = getQueryRows(traceResult).map((row) => ({
    traceId: row.traceId,
    count: Number(row.count),
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
    status: getIncidentStatus(incidentRow.lastSeen),
    rootCauseCandidates,
    correlations: {
      topRequestIds,
      topTraceIds,
    },
  });
}
