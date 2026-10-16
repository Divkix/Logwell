import { and, asc, eq, isNotNull, type SQL, sql } from "drizzle-orm";
import type { DatabaseClient } from "#lib/server/db/db.js";
import { getQueryRows } from "#lib/server/db/db.js";
import { project } from "#lib/server/db/schema.js";
import { projectLogs } from "#lib/server/utils/capped-count.js";
import { type BatchOptions, deleteInBatches, deleteProjectLogs } from "./log-cleanup";

export interface PurgeResult {
  projectsPurged: number;
  logsDeleted: number;
  incidentsDeleted: number;
  errors: string[];
}

const isDeletedProject = isNotNull(project.deletedAt);

function logsRemain(projectId: string): SQL<boolean> {
  return sql<boolean>`EXISTS (SELECT 1 FROM "log" WHERE ${projectLogs(projectId)})`;
}

/**
 * Finishes the deletion of every soft-deleted project: its logs, then its incidents, in paced
 * batches, then the row itself (whose cascade has nothing left to do).
 *
 * Each step is idempotent and `deleted_at` is the only state, so a run cut short by a restart,
 * a statement timeout or a failure resumes on the next run. One project failing does not stop
 * the others.
 *
 * Two runs can overlap (an old instance still purging while its replacement starts one). Both
 * pick the same oldest batch, so the one that waits on the other's row locks finds those rows
 * gone and gets a short batch while most logs remain. A short log batch therefore never leads
 * straight to the next step: the project is left to the other run (or the next one) unless no
 * log remains, and the row is deleted only once neither logs nor incidents do, so its cascade
 * never turns into the single large DELETE these batches exist to avoid.
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

      // Another run is still deleting them; incident deletion would SET NULL on each one left.
      const [logs] = getQueryRows<{ remaining: boolean }>(
        await db.execute(sql`SELECT ${logsRemain(id)} AS remaining`),
      );

      if (logs?.remaining) continue;

      result.incidentsDeleted += await deleteProjectIncidents(db, id, options);

      const removed = await db
        .delete(project)
        .where(
          and(
            eq(project.id, id),
            isDeletedProject,
            sql`NOT ${logsRemain(id)}`,
            sql`NOT EXISTS (SELECT 1 FROM "incident" WHERE "incident"."project_id" = ${id})`,
          ),
        )
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
