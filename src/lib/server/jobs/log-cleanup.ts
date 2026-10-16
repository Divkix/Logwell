import { sql } from "drizzle-orm";
import { RETENTION_CONFIG } from "#lib/server/config/performance.js";
import type { DatabaseClient } from "#lib/server/db/db.js";
import { getQueryRows } from "#lib/server/db/db.js";
import { project } from "#lib/server/db/schema.js";
import { OLDEST_FIRST, projectLogs } from "#lib/server/utils/capped-count.js";

export interface CleanupResult {
  projectsProcessed: number;
  projectsSkipped: number;
  totalLogsDeleted: number;
  errors: string[];
}

const BATCH_SIZE = 1000;

export async function cleanupOldLogs(dbClient?: DatabaseClient): Promise<CleanupResult> {
  const db = dbClient ?? (await import("#lib/server/db/index.js")).db;

  const result: CleanupResult = {
    projectsProcessed: 0,
    projectsSkipped: 0,
    totalLogsDeleted: 0,
    errors: [],
  };

  try {
    const projects = await db.select().from(project);

    if (projects.length === 0) {
      return result;
    }

    for (const proj of projects) {
      try {
        const effectiveRetention =
          proj.retentionDays !== null ? proj.retentionDays : RETENTION_CONFIG.LOG_RETENTION_DAYS;

        if (effectiveRetention === 0) {
          result.projectsSkipped++;
          continue;
        }

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - effectiveRetention);

        let deletedInProject = 0;

        while (true) {
          // Bind the cutoff as an ISO string: passing the Date object here is what broke cleanup.
          // projectLogs + OLDEST_FIRST keep each batch on idx_log_project_timestamp_id. With a plain
          // `project_id =` the planner may walk another index through every other project's
          // expired rows (measured on PG 18: 300k rows filtered for one empty batch), which the
          // pool's statement_timeout would cancel, stalling this project's retention for good.
          const raw = await db.execute(sql`
            WITH batch AS (
              SELECT id FROM "log"
              WHERE ${projectLogs(proj.id)}
                AND timestamp < ${cutoffDate.toISOString()}
              ORDER BY ${OLDEST_FIRST}
              LIMIT ${BATCH_SIZE}
            )
            DELETE FROM "log" WHERE id IN (SELECT id FROM batch)
            RETURNING id
          `);

          const rows = getQueryRows(raw);

          if (rows.length === 0) break;
          deletedInProject += rows.length;
        }

        if (deletedInProject > 0) {
          result.projectsProcessed++;
          result.totalLogsDeleted += deletedInProject;
        }
      } catch (error) {
        const errorMessage = `Failed to cleanup logs for project ${proj.id}: ${error instanceof Error ? error.message : String(error)}`;
        result.errors.push(errorMessage);
      }
    }

    return result;
  } catch (error) {
    const errorMessage = `Fatal error during log cleanup: ${error instanceof Error ? error.message : String(error)}`;
    result.errors.push(errorMessage);

    return result;
  }
}
