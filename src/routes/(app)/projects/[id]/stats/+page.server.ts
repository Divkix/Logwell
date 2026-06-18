import { and, count, eq, gte, type SQL } from "drizzle-orm";
import { getDbClient } from "$lib/server/db/db";
import { log } from "$lib/server/db/schema";
import { requireProjectOwnershipPage } from "$lib/server/utils/project-guard";
import { getTimeRangeStart } from "$lib/utils/format";
import { parseTimeRange } from "$lib/utils/time-range";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async (event) => {
  const projectId = event.params.id;
  const { project: projectData } = await requireProjectOwnershipPage(event, projectId);
  const db = await getDbClient(event.locals);

  // Parse query parameters - default to 24h for stats overview
  const url = event.url;
  const rangeParam = url.searchParams.get("range") || "24h";

  // Calculate time range
  const range = parseTimeRange(rangeParam);
  const fromDate = range ? getTimeRangeStart(range) : null;

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
