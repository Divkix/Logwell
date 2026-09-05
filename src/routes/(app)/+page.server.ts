import { count, desc, eq, max } from "drizzle-orm";
import { getDbClient } from "$lib/server/db/db";
import { log, project } from "$lib/server/db/schema";
import { requireAuth } from "$lib/server/utils/auth-guard";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async (event) => {
  const { user } = await requireAuth(event);
  const db = await getDbClient(event.locals);

  const projects = await db
    .select({
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    })
    .from(project)
    .where(eq(project.ownerId, user.id))
    .orderBy(desc(project.createdAt));

  const projectsWithStats = await Promise.all(
    projects.map(async (p) => {
      const [logCountResult] = await db
        .select({ count: count() })
        .from(log)
        .where(eq(log.projectId, p.id));

      const [lastLogResult] = await db
        .select({ lastActivity: max(log.timestamp) })
        .from(log)
        .where(eq(log.projectId, p.id));

      return {
        id: p.id,
        name: p.name,
        logCount: logCountResult?.count ?? 0,
        lastActivity: lastLogResult?.lastActivity?.toISOString() ?? null,
        createdAt: p.createdAt?.toISOString() ?? null,
        updatedAt: p.updatedAt?.toISOString() ?? null,
      };
    }),
  );

  return {
    projects: projectsWithStats,
  };
};
