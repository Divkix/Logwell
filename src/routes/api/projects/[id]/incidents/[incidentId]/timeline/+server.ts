import { json } from '@sveltejs/kit';
import { and, count, eq, gte, lte, type SQL, sql } from 'drizzle-orm';
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
  const bucketSeconds = config.intervalMs / 1000;
  const logTimestampExpression = sql`"log"."timestamp"`;
  const bucketStartExpression = sql<Date>`to_timestamp(
    (
      floor(
      (extract(epoch from ${logTimestampExpression}) - extract(epoch from ${rangeStart}::timestamptz)) / ${bucketSeconds}
      ) * ${bucketSeconds}
      + extract(epoch from ${rangeStart}::timestamptz)
    )::double precision
  )`;

  const aggregatedRows = await db
    .select({
      bucketStart: bucketStartExpression,
      count: count(),
    })
    .from(log)
    .where(whereClause)
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  const bucketCounts: Record<number, number> = {};
  for (const row of aggregatedRows) {
    if (!row.bucketStart) continue;
    const bucketStart =
      row.bucketStart instanceof Date ? row.bucketStart : new Date(row.bucketStart);
    const bucketIndex = Math.floor(
      (bucketStart.getTime() - rangeStart.getTime()) / config.intervalMs,
    );
    const rowCount = Number(row.count ?? 0);

    if (bucketIndex >= 0 && bucketIndex < config.expectedBuckets) {
      bucketCounts[bucketIndex] = (bucketCounts[bucketIndex] ?? 0) + rowCount;
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
