import { and, desc, eq } from "drizzle-orm";
import { getDbClient } from "#lib/server/db/db.js";
import { isActiveProject } from "#lib/server/db/predicates.js";
import { project } from "#lib/server/db/schema.js";
import { isCappedLogCount, projectLogStatsColumns } from "#lib/server/utils/capped-count.js";
import { requireAuth } from "#lib/server/utils/owned-project.js";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async (event) => {
  const { user } = await requireAuth(event);
  const db = await getDbClient(event.locals);

  // One statement: each project's count stops at LOG_COUNT_CEILING and its latest timestamp is
  // a single index probe, instead of an unbounded count(*) + max() pair per project.
  const projects = await db
    .select({
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      ...projectLogStatsColumns(),
    })
    .from(project)
    .where(and(eq(project.ownerId, user.id), isActiveProject))
    .orderBy(desc(project.createdAt));

  return {
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      logCount: p.logCount,
      logCountCapped: isCappedLogCount(p.logCount),
      lastActivity: p.lastActivity?.toISOString() ?? null,
      createdAt: p.createdAt?.toISOString() ?? null,
      updatedAt: p.updatedAt?.toISOString() ?? null,
    })),
  };
};
