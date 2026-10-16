import { eq } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import type * as schema from "../../../src/lib/server/db/schema";
import { log, project } from "../../../src/lib/server/db/schema";
import { setupTestDatabase } from "../../../src/lib/server/db/test-db";
import { createLogFactory, seedProject } from "../../fixtures/db";

describe("Log Table Schema", () => {
  let db: PgliteDatabase<typeof schema>;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
  });

  it("cascade deletes logs when the project is deleted", async () => {
    const testProject = await seedProject(db);
    await db
      .insert(log)
      .values([
        createLogFactory({ projectId: testProject.id }),
        createLogFactory({ projectId: testProject.id }),
        createLogFactory({ projectId: testProject.id }),
      ]);

    await db.delete(project).where(eq(project.id, testProject.id));

    const logsAfter = await db.select().from(log).where(eq(log.projectId, testProject.id));
    expect(logsAfter).toHaveLength(0);
  });

  it("supports full-text search over message content", async () => {
    const testProject = await seedProject(db);
    await db.insert(log).values([
      createLogFactory({ projectId: testProject.id, message: "User authentication failed" }),
      createLogFactory({ projectId: testProject.id, message: "Database connection successful" }),
      createLogFactory({
        projectId: testProject.id,
        message: "User authentication successful",
      }),
    ]);

    const searchResults = await db.execute<{ id: string; message: string }>(
      `SELECT id, message FROM log
       WHERE search @@ to_tsquery('english', 'authentication')
       ORDER BY message`,
    );

    expect(searchResults.rows).toHaveLength(2);
  });

  it("declares only the log indexes a query uses in schema.ts", async () => {
    const indexes = await db.execute<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'log' ORDER BY indexname`,
    );

    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      "idx_log_project_incident_timestamp",
      "idx_log_project_level_timestamp_id",
      "idx_log_project_timestamp_id",
      "idx_log_search",
      "log_pkey",
    ]);

    const definitionOf = (name: string) =>
      indexes.rows.find((row) => row.indexname === name)?.indexdef;

    expect(definitionOf("idx_log_project_timestamp_id")).toContain('(project_id, "timestamp", id)');
    expect(definitionOf("idx_log_project_level_timestamp_id")).toContain(
      '(project_id, level, "timestamp", id)',
    );
  });
});
