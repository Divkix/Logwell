import { setTimeout as sleep } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { RETENTION_CONFIG } from "#lib/server/config/performance.js";
import type { DatabaseClient } from "#lib/server/db/db.js";
import { getQueryRows } from "#lib/server/db/db.js";
import { isActiveProject } from "#lib/server/db/predicates.js";
import { project } from "#lib/server/db/schema.js";
import { OLDEST_FIRST, projectLogs } from "#lib/server/utils/capped-count.js";

export interface CleanupResult {
  projectsProcessed: number;
  projectsSkipped: number;
  totalLogsDeleted: number;
  /** Incidents past retention whose logs are all gone (see pruneExpiredIncidents). */
  totalIncidentsDeleted: number;
  errors: string[];
}

export interface BatchOptions {
  /** Rows per DELETE statement. */
  batchSize?: number;
  /** Pause between two batches (LOG_CLEANUP_BATCH_PAUSE_MS). */
  batchPauseMs?: number;
  /** Seam for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_BATCH_SIZE = 1000;

/**
 * Runs `deleteBatch(limit)` until it deletes fewer than `limit` rows, pausing between batches so
 * a large backlog is spread out instead of written to the WAL back-to-back. Returns the total.
 */
export async function deleteInBatches(
  deleteBatch: (limit: number) => Promise<number>,
  options: BatchOptions = {},
): Promise<number> {
  const {
    batchSize = DEFAULT_BATCH_SIZE,
    batchPauseMs = RETENTION_CONFIG.LOG_CLEANUP_BATCH_PAUSE_MS,
    sleep: pause = sleep,
  } = options;

  let total = 0;

  for (;;) {
    const deleted = await deleteBatch(batchSize);
    total += deleted;

    if (deleted < batchSize) return total;

    if (batchPauseMs > 0) await pause(batchPauseMs);
  }
}

/**
 * Deletes a project's logs older than `before` (all of them when omitted), oldest first, in
 * paced batches. Returns how many were deleted.
 */
export async function deleteProjectLogs(
  db: DatabaseClient,
  projectId: string,
  options: BatchOptions = {},
  before?: Date,
): Promise<number> {
  return deleteInBatches(async (limit) => {
    // Bind the cutoff as an ISO string: passing the Date object here is what broke cleanup.
    // projectLogs + OLDEST_FIRST keep each batch on idx_log_project_timestamp_id. With a plain
    // `project_id =` the planner may walk another index through every other project's expired
    // rows (measured on PG 18: 300k rows filtered for one empty batch), which the pool's
    // statement_timeout would cancel, stalling this project's retention for good.
    const raw = await db.execute(sql`
      WITH batch AS (
        SELECT id FROM "log"
        WHERE ${projectLogs(projectId)}
          ${before ? sql`AND timestamp < ${before.toISOString()}` : sql``}
        ORDER BY ${OLDEST_FIRST}
        LIMIT ${limit}
      )
      DELETE FROM "log" WHERE id IN (SELECT id FROM batch)
      RETURNING id
    `);

    return getQueryRows(raw).length;
  }, options);
}

/**
 * Deletes the project's incidents last seen before `cutoff` that no longer own any log, i.e.
 * the ones retention has emptied. Without this the incident table grows forever and the
 * incident list keeps showing groups whose events are gone.
 *
 * The NOT EXISTS guard keeps an incident that still owns a log (a late or back-dated event);
 * the outer `last_seen` re-check runs against the row as committed, so an incident an ingest
 * transaction bumps while this DELETE waits on its row lock survives. An event that lands on
 * an incident after it was pruned simply opens a new one (log.incident_id is ON DELETE SET
 * NULL, so a racing insert never fails).
 */
async function pruneExpiredIncidents(
  db: DatabaseClient,
  projectId: string,
  cutoff: Date,
  options: BatchOptions,
): Promise<number> {
  return deleteInBatches(async (limit) => {
    const raw = await db.execute(sql`
      DELETE FROM "incident"
      WHERE id IN (
        SELECT stale.id FROM "incident" AS stale
        WHERE stale.project_id = ${projectId}
          AND stale.last_seen < ${cutoff.toISOString()}
          AND NOT EXISTS (
            SELECT 1 FROM "log" AS owned
            WHERE owned.project_id = stale.project_id AND owned.incident_id = stale.id
          )
        ORDER BY stale.last_seen
        LIMIT ${limit}
      )
        AND project_id = ${projectId}
        AND last_seen < ${cutoff.toISOString()}
      RETURNING id
    `);

    return getQueryRows(raw).length;
  }, options);
}

export async function cleanupOldLogs(
  dbClient?: DatabaseClient,
  options: BatchOptions = {},
): Promise<CleanupResult> {
  const db = dbClient ?? (await import("#lib/server/db/index.js")).db;

  const result: CleanupResult = {
    projectsProcessed: 0,
    projectsSkipped: 0,
    totalLogsDeleted: 0,
    totalIncidentsDeleted: 0,
    errors: [],
  };

  try {
    // Deleted projects are purged whole by project-purge.ts.
    const projects = await db.select().from(project).where(isActiveProject);

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

        const deletedInProject = await deleteProjectLogs(db, proj.id, options, cutoffDate);

        const incidentsDeleted = await pruneExpiredIncidents(db, proj.id, cutoffDate, options);

        if (deletedInProject > 0 || incidentsDeleted > 0) {
          result.projectsProcessed++;
          result.totalLogsDeleted += deletedInProject;
          result.totalIncidentsDeleted += incidentsDeleted;
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
