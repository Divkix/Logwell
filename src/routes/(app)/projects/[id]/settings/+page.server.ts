import { error } from '@sveltejs/kit';
import { and, count, eq, min } from 'drizzle-orm';
import { RETENTION_CONFIG } from '$lib/server/config';
import { log, project } from '$lib/server/db/schema';
import { requireAuth } from '$lib/server/utils/auth-guard';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  // Require session authentication
  const { user } = await requireAuth(event);

  const { db } = await import('$lib/server/db');
  const projectId = event.params.id;

  // Fetch project data - verify ownership
  const [projectData] = await db
    .select()
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.ownerId, user.id)));

  if (!projectData) {
    throw error(404, { message: 'Project not found' });
  }

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
