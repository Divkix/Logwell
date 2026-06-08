import { count, desc, eq, max } from "drizzle-orm";
import { db } from "$lib/server/db";
import { log, project } from "$lib/server/db/schema";
import { requireAuth } from "$lib/server/utils/auth-guard";
import type { PageServerLoad } from "./$types";

/**
 * Dashboard page server load function.
 * Fetches all projects owned by the current user with log counts and last activity.
 */
export const load: PageServerLoad = async (event) => {
  // Require session authentication
  const { user } = await requireAuth(event);

  // Query only projects owned by the current user
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

  // Get log counts and last activity for each project
  const projectsWithStats = await Promise.all(
    projects.map(async (p) => {
      // Get log count
      const [logCountResult] = await db
        .select({ count: count() })
        .from(log)
        .where(eq(log.projectId, p.id));

      // Get last log timestamp
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
