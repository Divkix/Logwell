import { json } from '@sveltejs/kit';
import { and, eq, gte, lte, type SQL, sql } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '$lib/server/db/schema';
import { incident, log } from '$lib/server/db/schema';
import { isErrorResponse, requireProjectOwnership } from '$lib/server/utils/project-guard';
import { INCIDENT_RANGES, type IncidentRange } from '$lib/shared/types';
import { getTimeRangeStart } from '$lib/utils/format';
import { fillMissingBuckets, getTimeBucketConfig } from '$lib/utils/timeseries';
import type { RequestEvent } from './$types';

type DatabaseClient = PostgresJsDatabase<typeof schema> | PgliteDatabase<typeof schema>;

async function getDbClient(locals: App.Locals): Promise<DatabaseClient> {
  if (locals.db) return locals.db as DatabaseClient;
  const { db } = await import('$lib/server/db');
  return db;
}

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
    return json({ error: 'not_found', message: 'Incident not found' }, { status: 404 });
  }

  const rangeParam = event.url.searchParams.get('range') || '24h';
  const range: IncidentRange = INCIDENT_RANGES.includes(rangeParam as IncidentRange)
    ? (rangeParam as IncidentRange)
    : '24h';

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

  // Aggregate counts in SQL using time buckets relative to rangeStart
  const bucketResults = await db.execute(sql`
    SELECT
      floor(extract(epoch from (${log.timestamp} - ${rangeStart})) / ${intervalSeconds})::int AS bucket_index,
      count(*)::int AS count
    FROM ${log}
    WHERE ${whereClause}
    GROUP BY 1
    ORDER BY 1
  `);

  // Convert SQL results to bucket map (handle both PGlite Results and postgres-js RowList)
  const rows = 'rows' in bucketResults ? bucketResults.rows : Array.from(bucketResults);
  const bucketCounts: Record<number, number> = {};
  for (const row of rows) {
    const idx = row.bucket_index as number;
    const count = row.count as number;
    if (idx >= 0 && idx < config.expectedBuckets) {
      bucketCounts[idx] = count;
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
