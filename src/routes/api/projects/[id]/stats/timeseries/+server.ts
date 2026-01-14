import { json } from '@sveltejs/kit';
import { and, eq, gte, lte, type SQL } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { TimeRange } from '$lib/components/time-range-picker.svelte';
import type * as schema from '$lib/server/db/schema';
import { log, project } from '$lib/server/db/schema';
import { requireAuth } from '$lib/server/utils/auth-guard';
import { getTimeRangeStart } from '$lib/utils/format';
import { bucketTimestamps, fillMissingBuckets, getTimeBucketConfig } from '$lib/utils/timeseries';
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

/**
 * GET /api/projects/[id]/stats/timeseries
 *
 * Returns time-bucketed log counts for visualization in an area chart.
 * Requires session authentication.
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
 * - 404 not_found: Project does not exist
 */
export async function GET(event: RequestEvent): Promise<Response> {
  // Require session authentication
  await requireAuth(event);

  const db = await getDbClient(event.locals);
  const projectId = event.params.id;

  // Verify project exists
  const [projectData] = await db
    .select({ id: project.id })
    .from(project)
    .where(eq(project.id, projectId));

  if (!projectData) {
    return json({ error: 'not_found', message: 'Project not found' }, { status: 404 });
  }

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

  // Fetch log timestamps in range
  const logs = await db.select({ timestamp: log.timestamp }).from(log).where(whereClause);

  // Convert to Date objects (filter nulls)
  const timestamps = logs.map((l) => l.timestamp).filter((ts): ts is Date => ts !== null);

  // Bucket the timestamps
  const bucketCounts = bucketTimestamps(timestamps, config, rangeStart);
  const buckets = fillMissingBuckets(bucketCounts, config, rangeStart, rangeEnd);

  // Calculate total
  const totalCount = timestamps.length;

  return json({
    buckets,
    range,
    totalCount,
  });
}
