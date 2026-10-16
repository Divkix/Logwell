import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { type DatabaseClient, getQueryRows } from "#lib/server/db/db.js";
import { log } from "#lib/server/db/schema.js";
import type {
  IncidentCorrelationSummary,
  IncidentSourceFrequency,
} from "#lib/shared/schemas/incident.js";

/** How many of an incident's most recent events the detail view aggregates over. */
export const INCIDENT_ANALYSIS_EVENT_LIMIT = 10_000;

export interface IncidentEventAnalysis {
  /** Events actually aggregated: min(stored events, limit). */
  analyzedEvents: number;
  rootCauseCandidates: IncidentSourceFrequency[];
  correlations: IncidentCorrelationSummary;
}

// The driver hands back json columns already parsed; validate their shape at this boundary.
const analysisRowSchema = z.object({
  analyzedEvents: z.coerce.number(),
  rootCauseCandidates: z.array(
    z.object({
      sourceFile: z.string().nullable(),
      lineNumber: z.number().int().nullable(),
      count: z.number(),
    }),
  ),
  topRequestIds: z.array(z.object({ requestId: z.string(), count: z.number() })),
  topTraceIds: z.array(z.object({ traceId: z.string(), count: z.number() })),
});

/**
 * Root-cause and correlation frequencies over an incident's most recent `limit` events.
 *
 * A long-running incident can own millions of logs; grouping all of them three times per
 * detail view grows without bound. Instead one statement reads the newest `limit` events once
 * (an idx_log_project_incident_timestamp range, newest first) into a materialized CTE and
 * aggregates all three rankings from it.
 */
export async function analyzeRecentIncidentEvents(
  db: DatabaseClient,
  projectId: string,
  incidentId: string,
  limit: number = INCIDENT_ANALYSIS_EVENT_LIMIT,
): Promise<IncidentEventAnalysis> {
  const result = await db.execute(sql`
    with recent as materialized (
      select
        ${log.sourceFile} as "sourceFile",
        ${log.lineNumber} as "lineNumber",
        ${log.requestId} as "requestId",
        ${log.traceId} as "traceId"
      from ${log}
      where ${and(eq(log.projectId, projectId), eq(log.incidentId, incidentId))}
      order by ${log.timestamp} desc
      limit ${limit}
    )
    select
      (select count(*)::int from recent) as "analyzedEvents",
      (
        select coalesce(
          json_agg(
            json_build_object('sourceFile', s."sourceFile", 'lineNumber', s."lineNumber", 'count', s."count")
            order by s."count" desc, s."sourceFile" asc nulls last, s."lineNumber" asc nulls last
          ),
          '[]'::json
        )
        from (
          select "sourceFile", "lineNumber", count(*)::int as "count"
          from recent
          group by "sourceFile", "lineNumber"
          order by "count" desc, "sourceFile" asc nulls last, "lineNumber" asc nulls last
          limit 5
        ) s
      ) as "rootCauseCandidates",
      (
        select coalesce(
          json_agg(
            json_build_object('requestId', r."requestId", 'count', r."count")
            order by r."count" desc, r."requestId" asc
          ),
          '[]'::json
        )
        from (
          select "requestId", count(*)::int as "count"
          from recent
          where "requestId" is not null and "requestId" <> ''
          group by "requestId"
          order by "count" desc, "requestId" asc
          limit 10
        ) r
      ) as "topRequestIds",
      (
        select coalesce(
          json_agg(
            json_build_object('traceId', t."traceId", 'count', t."count")
            order by t."count" desc, t."traceId" asc
          ),
          '[]'::json
        )
        from (
          select "traceId", count(*)::int as "count"
          from recent
          where "traceId" is not null and "traceId" <> ''
          group by "traceId"
          order by "count" desc, "traceId" asc
          limit 10
        ) t
      ) as "topTraceIds"
  `);

  const { analyzedEvents, rootCauseCandidates, topRequestIds, topTraceIds } =
    analysisRowSchema.parse(getQueryRows(result)[0]);

  return {
    analyzedEvents,
    rootCauseCandidates,
    correlations: { topRequestIds, topTraceIds },
  };
}
