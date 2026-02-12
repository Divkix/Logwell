import { json } from '@sveltejs/kit';
import { and, eq, gte, lte, type SQL } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '$lib/server/db/schema';
import { incident, log } from '$lib/server/db/schema';
import { isErrorResponse, requireProjectOwnership } from '$lib/server/utils/project-guard';
import { INCIDENT_RANGES, type IncidentRange } from '$lib/shared/types';
import { getTimeRangeStart } from '$lib/utils/format';
import { bucketTimestamps, fillMissingBuckets, getTimeBucketConfig } from '$lib/utils/timeseries';
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

  const logs = await db.select({ timestamp: log.timestamp }).from(log).where(whereClause);
  const timestamps = logs.map((l) => l.timestamp).filter((ts): ts is Date => ts !== null);

  const bucketCounts = bucketTimestamps(timestamps, config, rangeStart);
  const buckets = fillMissingBuckets(bucketCounts, config, rangeStart, rangeEnd);
  const peakBucket = buckets.reduce<{ timestamp: string; count: number } | null>(
    (peak, bucket) => {
      if (!peak) return bucket;
      return bucket.count > peak.count ? bucket : peak;
    },
    null,
  );

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
