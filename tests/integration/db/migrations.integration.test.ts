import { PGlite } from "@electric-sql/pglite";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { setupTestDatabase } from "#lib/server/db/test-db.js";

// The rest of the integration tier builds its DDL by reflecting schema.ts; these tests run the
// committed drizzle/*.sql instead, statement by statement in journal order (PGlite's extended
// protocol rejects the multi-statement chunks some older migrations have, so each chunk goes
// through the simple protocol).
const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });

const INDEX_DEFINITIONS_SQL = `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexdef`;

async function applyMigrations(client: PGlite, from: number, to: number): Promise<void> {
  for (const migration of migrations.slice(from, to)) {
    for (const statement of migration.sql) {
      await client.exec(statement);
    }
  }
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
});
