import { and, count, eq, gte } from "drizzle-orm";
import { log } from "$lib/server/db/schema";
import { requireOwnedProjectPage } from "$lib/server/utils/owned-project";
import { getTimeRangeStart } from "$lib/utils/format";
import { parseTimeRange, type TimeRange } from "$lib/utils/time-range";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async (event) => {
  const projectId = event.params.id;
  const { project: projectData, db } = await requireOwnedProjectPage(event, projectId);

  const url = event.url;
  const range: TimeRange = parseTimeRange(url.searchParams.get("range")) ?? "24h";
  const fromDate = getTimeRangeStart(range);

  const whereClause = and(eq(log.projectId, projectId), gte(log.timestamp, fromDate));

  const levelCounts = await db
    .select({
      level: log.level,
      count: count(),
    })
    .from(log)
    .where(whereClause)
    .groupBy(log.level);

  const levelCountsObj: Record<string, number> = {};
  let totalLogs = 0;

  for (const { level, count: levelCount } of levelCounts) {
    if (level) {
      levelCountsObj[level] = levelCount;
      totalLogs += levelCount;
    }
  }

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
      range,
      from: fromDate.toISOString(),
    },
  };
};
