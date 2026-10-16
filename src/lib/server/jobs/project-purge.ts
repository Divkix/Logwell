import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import type { DatabaseClient } from "#lib/server/db/db.js";
import { getQueryRows } from "#lib/server/db/db.js";
import { project } from "#lib/server/db/schema.js";
import { type BatchOptions, deleteInBatches, deleteProjectLogs } from "./log-cleanup";

export interface PurgeResult {
  projectsPurged: number;
  logsDeleted: number;
  incidentsDeleted: number;
  errors: string[];
}

const isDeletedProject = isNotNull(project.deletedAt);

/**
 * Finishes the deletion of every soft-deleted project: its logs, then its incidents, in paced
 * batches, then the row itself (whose cascade has nothing left to do).
 *
 * Each step is idempotent and `deleted_at` is the only state, so a run cut short by a restart,
 * a statement timeout or a failure resumes on the next run, and two concurrent runs merely
 * share the work. One project failing does not stop the others.
 */
export async function purgeDeletedProjects(
  dbClient?: DatabaseClient,
  options: BatchOptions = {},
): Promise<PurgeResult> {
  const db = dbClient ?? (await import("#lib/server/db/index.js")).db;

  const result: PurgeResult = {
    projectsPurged: 0,
    logsDeleted: 0,
    incidentsDeleted: 0,
    errors: [],
  };

  let deleted: { id: string }[];

  try {
    deleted = await db
      .select({ id: project.id })
      .from(project)
      .where(isDeletedProject)
      .orderBy(asc(project.deletedAt));
  } catch (error) {
    result.errors.push(
      `Failed to list deleted projects: ${error instanceof Error ? error.message : String(error)}`,
    );

    return result;
  }

  for (const { id } of deleted) {
    try {
      result.logsDeleted += await deleteProjectLogs(db, id, options);
      result.incidentsDeleted += await deleteProjectIncidents(db, id, options);

      const removed = await db
        .delete(project)
        .where(and(eq(project.id, id), isDeletedProject))
        .returning();

      result.projectsPurged += removed.length;
    } catch (error) {
      result.errors.push(
        `Failed to purge project ${id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return result;
}

function deleteProjectIncidents(
  db: DatabaseClient,
  projectId: string,
  options: BatchOptions,
): Promise<number> {
  return deleteInBatches(async (limit) => {
    const raw = await db.execute(sql`
      DELETE FROM "incident"
      WHERE id IN (SELECT id FROM "incident" WHERE project_id = ${projectId} LIMIT ${limit})
      RETURNING id
    `);

    return getQueryRows(raw).length;
  }, options);
}
