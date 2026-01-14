import { error } from '@sveltejs/kit';
import { and, count, eq, gte, type SQL } from 'drizzle-orm';
import { log, project } from '$lib/server/db/schema';
import { requireAuth } from '$lib/server/utils/auth-guard';
import type { PageServerLoad } from './$types';

/**
 * Get time range start date based on range parameter
 * Stats page defaults to 24h for broader overview
 */
function getTimeRangeStart(range: string | null): Date | null {
  if (!range) return null;

  const now = Date.now();
  switch (range) {
    case '15m':
      return new Date(now - 15 * 60 * 1000);
    case '1h':
      return new Date(now - 60 * 60 * 1000);
    case '24h':
      return new Date(now - 24 * 60 * 60 * 1000);
    case '7d':
      return new Date(now - 7 * 24 * 60 * 60 * 1000);
    default:
      return null;
  }
}

export const load: PageServerLoad = async (event) => {
  // Require session authentication
  await requireAuth(event);

  const { db } = await import('$lib/server/db');
  const projectId = event.params.id;

  // Fetch project data
  const [projectData] = await db.select().from(project).where(eq(project.id, projectId));

  if (!projectData) {
    throw error(404, { message: 'Project not found' });
  }

  // Parse query parameters - default to 24h for stats overview
  const url = event.url;
  const rangeParam = url.searchParams.get('range') || '24h';

  // Calculate time range
  const fromDate = getTimeRangeStart(rangeParam);

  // Build WHERE conditions
  const conditions: SQL[] = [eq(log.projectId, projectId)];

  // Time range filter
  if (fromDate) {
    conditions.push(gte(log.timestamp, fromDate));
  }

  const whereClause = and(...conditions);

  // Get level distribution counts
  const levelCounts = await db
    .select({
      level: log.level,
      count: count(),
    })
    .from(log)
    .where(whereClause)
    .groupBy(log.level);

  // Convert level counts to object and calculate total
  const levelCountsObj: Record<string, number> = {};
  let totalLogs = 0;

  for (const { level, count: levelCount } of levelCounts) {
    if (level) {
      levelCountsObj[level] = levelCount;
      totalLogs += levelCount;
    }
  }

  // Calculate percentages
  const levelPercentagesObj: Record<string, number> = {};

  if (totalLogs > 0) {
    for (const [level, levelCount] of Object.entries(levelCountsObj)) {
      levelPercentagesObj[level] = Number(((levelCount / totalLogs) * 100).toFixed(2));
    }
  }

  return {
    project: {
      id: projectData.id,
      name: projectData.name,
      apiKey: projectData.apiKey,
      createdAt: projectData.createdAt?.toISOString() ?? null,
      updatedAt: projectData.updatedAt?.toISOString() ?? null,
    },
    stats: {
      totalLogs,
      levelCounts: levelCountsObj,
      levelPercentages: levelPercentagesObj,
    },
    filters: {
      range: rangeParam,
      // Pass the exact timestamp used so timeseries can use the same range
      from: fromDate?.toISOString() ?? null,
    },
  };
};
