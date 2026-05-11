import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { RETENTION_CONFIG } from '$lib/server/config';
import { log, project } from '$lib/server/db/schema';

type DatabaseClient =
  | PostgresJsDatabase<typeof import('$lib/server/db/schema')>
  | PgliteDatabase<typeof import('$lib/server/db/schema')>;

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
  const db = dbClient ?? (await import('$lib/server/db')).db;

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

        // Count logs to delete first (for reporting)
        const logsToDeleteCount = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(log)
          .where(and(eq(log.projectId, proj.id), lt(log.timestamp, cutoffDate)));

        const totalToDelete = logsToDeleteCount[0]?.count || 0;

        if (totalToDelete === 0) {
          // No logs to delete for this project
          continue;
        }

        // Batch delete logs in chunks of BATCH_SIZE
        let deletedInProject = 0;
        while (deletedInProject < totalToDelete) {
          // Get a batch of log IDs to delete
          const logsToDelete = await db
            .select({ id: log.id })
            .from(log)
            .where(and(eq(log.projectId, proj.id), lt(log.timestamp, cutoffDate)))
            .orderBy(asc(log.id))
            .limit(BATCH_SIZE);

          if (logsToDelete.length === 0) {
            break;
          }

          // Delete the batch
          const idsToDelete = logsToDelete.map((l) => l.id);
          await db.delete(log).where(inArray(log.id, idsToDelete));

          deletedInProject += logsToDelete.length;
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
