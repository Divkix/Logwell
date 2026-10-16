import { isNull } from "drizzle-orm";
import { project } from "./schema";

// Kept free of app modules (env, Kit, CSRF) so jobs, ingest and the tsx scripts can share it.

/**
 * Excludes soft-deleted projects (DELETE /api/projects/[id] sets `deleted_at`; the purge job
 * removes the row later). Every query that lists or resolves projects for use must apply it.
 */
export const isActiveProject = isNull(project.deletedAt);
