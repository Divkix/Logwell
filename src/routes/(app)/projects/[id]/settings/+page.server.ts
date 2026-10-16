import { eq } from "drizzle-orm";
import { RETENTION_CONFIG } from "#lib/server/config/performance.js";
import { project } from "#lib/server/db/schema.js";
import {
  isCappedLogCount,
  oldestLogColumn,
  projectLogStatsColumns,
} from "#lib/server/utils/capped-count.js";
import { requireOwnedProjectPage } from "#lib/server/utils/owned-project.js";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async (event) => {
  const projectId = event.params.id;
  const { project: projectData, db } = await requireOwnedProjectPage(event, projectId);

  // Bounded: the count stops at LOG_COUNT_CEILING and the oldest timestamp is one index probe.
  const { logCount } = projectLogStatsColumns();

  const [logStats] = await db
    .select({ totalLogs: logCount, oldestLog: oldestLogColumn() })
    .from(project)
    .where(eq(project.id, projectId));

  const totalLogs = logStats?.totalLogs ?? 0;

  return {
    project: {
      id: projectData.id,
      name: projectData.name,
      retentionDays: projectData.retentionDays,
      createdAt: projectData.createdAt?.toISOString() ?? null,
      updatedAt: projectData.updatedAt?.toISOString() ?? null,
    },
    stats: {
      totalLogs,
      totalLogsCapped: isCappedLogCount(totalLogs),
      oldestLogDate: logStats?.oldestLog?.toISOString() ?? null,
    },
    systemDefault: {
      retentionDays: RETENTION_CONFIG.LOG_RETENTION_DAYS,
    },
  };
};
