import { json } from '@sveltejs/kit';
import { and, eq, gte, lte, type SQL, sql } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { TimeRange } from '$lib/components/time-range-picker.svelte';
import type * as schema from '$lib/server/db/schema';
import { log } from '$lib/server/db/schema';
import { isErrorResponse, requireProjectOwnership } from '$lib/server/utils/project-guard';
import { getTimeRangeStart } from '$lib/utils/format';
import { fillMissingBuckets, getTimeBucketConfig } from '$lib/utils/timeseries';
import type { RequestEvent } from './$types';

type DatabaseClient = PostgresJsDatabase<typeof schema> | PgliteDatabase<typeof schema>;

/**
 * Helper to get database client from locals or production db
 * Supports test injection via locals.db
 */
async function getDbClient(locals: App.Locals): Promise<DatabaseClient> {
  if (locals.db) {
    return locals.db as DatabaseClient;
  }
  const { db } = await import('$lib/server/db');
  return db;
}

const VALID_RANGES: TimeRange[] = ['15m', '1h', '24h', '7d'];

type BucketCountRow = {
  bucketIndex: number;
  count: number;
};

type QueryRows<T> = T[] | { rows: T[] };

function getQueryRows<T>(result: QueryRows<T>): T[] {
  return Array.isArray(result) ? result : result.rows;
}

/**
 * GET /api/projects/[id]/stats/timeseries
 *
 * Returns time-bucketed log counts for visualization in an area chart.
 * Requires session authentication and project ownership.
 *
 * Query Parameters:
 * - range: string ('15m' | '1h' | '24h' | '7d') - Time range, defaults to '24h'
 * - from: string (ISO 8601) - Optional start timestamp to sync with page server
 *
 * Response:
 * {
 *   buckets: [
 *     { timestamp: string, count: number },
 *     ...
 *   ],
 *   range: string,
 *   totalCount: number
 * }
 *
 * Error responses:
 * - 303 redirect to /login: Not authenticated
 * - 404 not_found: Project does not exist or not owned by user
 */
export async function GET(event: RequestEvent): Promise<Response> {
  // Require authentication and project ownership
  const authResult = await requireProjectOwnership(event, event.params.id);
  if (isErrorResponse(authResult)) return authResult;

  const db = await getDbClient(event.locals);
  const projectId = event.params.id;

  // Parse range parameter (default to 24h)
  const rangeParam = event.url.searchParams.get('range') || '24h';
  const range: TimeRange = VALID_RANGES.includes(rangeParam as TimeRange)
    ? (rangeParam as TimeRange)
    : '24h';

  // Parse optional from parameter (to sync with page server's time range)
  const fromParam = event.url.searchParams.get('from');

  // Calculate time boundaries
  // If 'from' is provided, use it to ensure consistency with page server
  // Otherwise calculate from current time
  const rangeEnd = new Date();
  const rangeStart = fromParam ? new Date(fromParam) : getTimeRangeStart(range, rangeEnd);
  const config = getTimeBucketConfig(range);

  // Build WHERE conditions
  const conditions: SQL[] = [
    eq(log.projectId, projectId),
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
  let totalCount = 0;
  for (const row of getQueryRows(bucketResult)) {
    const bucketIndex = Number(row.bucketIndex);
    const count = Number(row.count);
    if (bucketIndex >= 0 && bucketIndex < config.expectedBuckets) {
      bucketCounts[bucketIndex] = count;
      totalCount += count;
    }
  }

  const buckets = fillMissingBuckets(bucketCounts, config, rangeStart, rangeEnd);

  return json({
    buckets,
    range,
    totalCount,
  });
}
