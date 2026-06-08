import { sql } from "drizzle-orm";
import { RETENTION_CONFIG } from "$lib/server/config";
import type { DatabaseClient } from "$lib/server/db/db";
import { getQueryRows } from "$lib/server/db/db";
import { project } from "$lib/server/db/schema";

export interface CleanupResult {
  projectsProcessed: number;
  projectsSkipped: number;
  totalLogsDeleted: number;
  errors: string[];
}

const BATCH_SIZE = 1000;

/**
 * Cleanup old logs based on retention policies.
 *
 * Retention logic:
 * - If project.retentionDays is set (not null): use that value
 * - If project.retentionDays is null: use system default (RETENTION_CONFIG.LOG_RETENTION_DAYS)
 * - If effective retention is 0: never delete (skip project)
 * - Otherwise: delete logs older than effective retention days
 *
 * @param dbClient - Optional database client (for testing)
 * @returns Summary of cleanup operation
 */
export async function cleanupOldLogs(dbClient?: DatabaseClient): Promise<CleanupResult> {
  const db = dbClient ?? (await import("$lib/server/db")).db;

  const result: CleanupResult = {
    projectsProcessed: 0,
    projectsSkipped: 0,
    totalLogsDeleted: 0,
    errors: [],
  };

  try {
    // 1. Get all projects
    const projects = await db.select().from(project);

    if (projects.length === 0) {
      return result;
    }

    // 2. Process each project
    for (const proj of projects) {
      try {
        // Calculate effective retention
        const effectiveRetention =
          proj.retentionDays !== null ? proj.retentionDays : RETENTION_CONFIG.LOG_RETENTION_DAYS;

        // Skip if retention is 0 (never delete)
        if (effectiveRetention === 0) {
          result.projectsSkipped++;
          continue;
        }

        // Calculate cutoff date (now - retention days)
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - effectiveRetention);

        // Batch delete logs using a CTE to avoid count + id-select round-trips
        let deletedInProject = 0;
        while (true) {
          const raw = await db.execute(sql`
            WITH batch AS (
              SELECT id FROM "log"
              WHERE project_id = ${proj.id}
                AND timestamp < ${cutoffDate}
              ORDER BY timestamp ASC
              LIMIT ${BATCH_SIZE}
            )
            DELETE FROM "log" WHERE id IN (SELECT id FROM batch)
            RETURNING id
          `);
          const rows = getQueryRows(raw as Parameters<typeof getQueryRows>[0]);
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
