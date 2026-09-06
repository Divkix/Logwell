import { count, eq, min } from "drizzle-orm";
import { RETENTION_CONFIG } from "$lib/server/config/performance";
import { log } from "$lib/server/db/schema";
import { requireOwnedProjectPage } from "$lib/server/utils/owned-project";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async (event) => {
  const projectId = event.params.id;
  const { project: projectData, db } = await requireOwnedProjectPage(event, projectId);

  const [logStats] = await db
    .select({
      totalLogs: count(),
      oldestLog: min(log.timestamp),
    })
    .from(log)
    .where(eq(log.projectId, projectId));

  return {
    project: {
      id: projectData.id,
      name: projectData.name,
      retentionDays: projectData.retentionDays,
      createdAt: projectData.createdAt?.toISOString() ?? null,
      updatedAt: projectData.updatedAt?.toISOString() ?? null,
    },
    stats: {
      totalLogs: logStats?.totalLogs ?? 0,
      oldestLogDate: logStats?.oldestLog?.toISOString() ?? null,
    },
    systemDefault: {
      retentionDays: RETENTION_CONFIG.LOG_RETENTION_DAYS,
    },
  };
};
