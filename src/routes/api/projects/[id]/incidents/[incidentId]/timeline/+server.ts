import { json } from "@sveltejs/kit";
import { and, eq, gte, lte, type SQL, sql } from "drizzle-orm";
import { type BucketCountRow, getDbClient, getQueryRows } from "$lib/server/db/db";
import { incident, log } from "$lib/server/db/schema";
import { apiError } from "$lib/server/utils/api-error";
import { isErrorResponse, requireProjectOwnership } from "$lib/server/utils/project-guard";
import type { IncidentRange } from "$lib/shared/types";
import { getTimeRangeStart } from "$lib/utils/format";
import { parseTimeRange } from "$lib/utils/time-range";
import { fillMissingBuckets, getTimeBucketConfig } from "$lib/utils/timeseries";
import type { RequestEvent } from "./$types";

/**
 * GET /api/projects/[id]/incidents/[incidentId]/timeline
 */
export async function GET(event: RequestEvent): Promise<Response> {
  const authResult = await requireProjectOwnership(event, event.params.id);
  if (isErrorResponse(authResult)) return authResult;

  const db = await getDbClient(event.locals);
  const projectId = event.params.id;
  const incidentId = event.params.incidentId;

  const [incidentRow] = await db
    .select({
      id: incident.id,
      firstSeen: incident.firstSeen,
      lastSeen: incident.lastSeen,
    })
    .from(incident)
    .where(and(eq(incident.projectId, projectId), eq(incident.id, incidentId)));

  if (!incidentRow) {
    return apiError(404, "not_found", "Incident not found");
  }

  const range: IncidentRange = parseTimeRange(event.url.searchParams.get("range")) ?? "24h";

  const rangeEnd = new Date();
  const rangeStart = getTimeRangeStart(range, rangeEnd);
  const config = getTimeBucketConfig(range);

  const conditions: SQL[] = [
    eq(log.projectId, projectId),
    eq(log.incidentId, incidentId),
    gte(log.timestamp, rangeStart),
    lte(log.timestamp, rangeEnd),
  ];
  const whereClause = and(...conditions);
  const intervalSeconds = config.intervalMs / 1000;
  const rangeStartEpochSeconds = rangeStart.getTime() / 1000;

  const bucketResult = await db.execute(sql<BucketCountRow>`
    select
      floor(
        (extract(epoch from ${log.timestamp}) - ${rangeStartEpochSeconds}) / ${intervalSeconds}
      )::int as "bucketIndex",
      count(*)::int as "count"
    from ${log}
    where ${whereClause}
    group by 1
    order by 1
  `);

  const bucketCounts: Record<number, number> = {};
  for (const row of getQueryRows(bucketResult)) {
    const bucketIndex = Number(row.bucketIndex);
    const count = Number(row.count);
    if (bucketIndex >= 0 && bucketIndex < config.expectedBuckets) {
      bucketCounts[bucketIndex] = count;
    }
  }

  const buckets = fillMissingBuckets(bucketCounts, config, rangeStart, rangeEnd);
  const peakBucket = buckets.reduce<{ timestamp: string; count: number } | null>((peak, bucket) => {
    if (!peak) return bucket;
    return bucket.count > peak.count ? bucket : peak;
  }, null);

  return json({
    incidentId: incidentRow.id,
    range,
    buckets,
    peakBucket: peakBucket && peakBucket.count > 0 ? peakBucket : null,
    anchors: {
      firstSeen: incidentRow.firstSeen.toISOString(),
      lastSeen: incidentRow.lastSeen.toISOString(),
    },
  });
}
