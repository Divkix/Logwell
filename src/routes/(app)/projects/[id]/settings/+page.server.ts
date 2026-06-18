import { count, eq, min } from "drizzle-orm";
import { RETENTION_CONFIG } from "$lib/server/config";
import { getDbClient } from "$lib/server/db/db";
import { log } from "$lib/server/db/schema";
import { requireProjectOwnershipPage } from "$lib/server/utils/project-guard";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async (event) => {
  const projectId = event.params.id;
  const { project: projectData } = await requireProjectOwnershipPage(event, projectId);
  const db = await getDbClient(event.locals);

  // Get log stats: total count and oldest log date
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
