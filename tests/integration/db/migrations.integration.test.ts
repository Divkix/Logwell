import { PGlite } from "@electric-sql/pglite";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { setupTestDatabase } from "#lib/server/db/test-db.js";

// The rest of the integration tier builds its DDL by reflecting schema.ts; these tests run the
// committed drizzle/*.sql instead, statement by statement in journal order (PGlite's extended
// protocol rejects the multi-statement chunks some older migrations have, so each chunk goes
// through the simple protocol).
const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });

const LOG_INDEX_REWORK = migrations.findIndex((migration) =>
  migration.sql.some((statement) => statement.includes('"idx_log_project_level_timestamp_id"')),
);

const INDEX_DEFINITIONS_SQL = `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexdef`;

async function applyMigrations(client: PGlite, from: number, to: number): Promise<void> {
  for (const migration of migrations.slice(from, to)) {
    for (const statement of migration.sql) {
      await client.exec(statement);
    }
  }
}

async function indexExists(client: PGlite, name: string): Promise<boolean> {
  const { rows } = await client.query<{ name: string }>(
    "SELECT indexname AS name FROM pg_indexes WHERE indexname = $1",
    [name],
  );

  return rows.length === 1;
}

// Each test boots a fresh PGlite and replays every migration (the first boots two); that takes
// 6–8s on CI runners, past the 5s default.
describe("drizzle migrations", { timeout: 30_000 }, () => {
  const clients: PGlite[] = [];

  async function freshClient(): Promise<PGlite> {
    const client = await PGlite.create();
    clients.push(client);

    return client;
  }

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
  });

  it("produce the same indexes as the schema.ts the test tier reflects", async () => {
    const migrated = await freshClient();
    await applyMigrations(migrated, 0, migrations.length);

    const { db, cleanup } = await setupTestDatabase();

    try {
      const reflected = await db.execute<{ indexdef: string }>(INDEX_DEFINITIONS_SQL);
      const fromMigrations = await migrated.query<{ indexdef: string }>(INDEX_DEFINITIONS_SQL);

      expect(fromMigrations.rows.map((row) => row.indexdef)).toEqual(
        reflected.rows.map((row) => row.indexdef),
      );
    } finally {
      await cleanup();
    }
  });

  it("0013 refuses to drop the old log index when a pre-built replacement is invalid", async () => {
    const client = await freshClient();
    await applyMigrations(client, 0, LOG_INDEX_REWORK);

    // What a failed or cancelled CREATE INDEX CONCURRENTLY leaves behind.
    await client.exec(`
      CREATE INDEX "idx_log_project_timestamp_id" ON "log" ("project_id", "timestamp", "id");
      UPDATE pg_index SET indisvalid = false
      WHERE indexrelid = '"idx_log_project_timestamp_id"'::regclass;
    `);

    // The migrator runs pending migrations in one transaction.
    await expect(
      client.transaction(async (tx) => {
        for (const statement of migrations[LOG_INDEX_REWORK]?.sql ?? []) {
          await tx.exec(statement);
        }
      }),
    ).rejects.toThrow(/invalid index\(es\) on "log": idx_log_project_timestamp_id/);

    expect(await indexExists(client, "idx_log_project_timestamp")).toBe(true);
  });

  it("0013 adopts valid pre-built indexes and drops the ones they replace", async () => {
    const client = await freshClient();
    await applyMigrations(client, 0, LOG_INDEX_REWORK);

    await client.exec(`
      CREATE INDEX "idx_log_project_timestamp_id" ON "log" ("project_id", "timestamp", "id");
      CREATE INDEX "idx_log_project_level_timestamp_id" ON "log" ("project_id", "level", "timestamp", "id");
    `);

    await applyMigrations(client, LOG_INDEX_REWORK, LOG_INDEX_REWORK + 1);

    expect(await indexExists(client, "idx_log_project_timestamp_id")).toBe(true);
    expect(await indexExists(client, "idx_log_project_timestamp")).toBe(false);
  });
});
