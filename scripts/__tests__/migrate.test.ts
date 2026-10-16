import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { MIGRATION_LOCK_KEY, withMigrationLock } from "../migrate";

// PGlite rejects multi-statement migration files, so these tests use a minimal single-statement
// journal instead of drizzle/; the real folder is exercised against Postgres by CI's e2e job.
function writeMigrations(dir: string) {
  mkdirSync(join(dir, "meta"));

  const entries = [
    { tag: "0000_first", when: 1_700_000_000_000, body: 'CREATE TABLE "a" ("id" integer);' },
    { tag: "0001_second", when: 1_700_000_001_000, body: 'CREATE TABLE "b" ("id" integer);' },
  ];

  for (const entry of entries) writeFileSync(join(dir, `${entry.tag}.sql`), entry.body);
  writeFileSync(
    join(dir, "meta", "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "postgresql",
      entries: entries.map(({ tag, when }, idx) => ({
        idx,
        version: "7",
        when,
        tag,
        breakpoints: true,
      })),
    }),
  );
}

async function heldMigrationLocks(db: PgliteDatabase): Promise<number> {
  const result = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from pg_locks
        where locktype = 'advisory' and classid = 0 and objid = ${MIGRATION_LOCK_KEY}`,
  );

  return result.rows[0].count;
}

async function appliedMigrations(db: PgliteDatabase): Promise<number> {
  // drizzle-kit migrate's default bookkeeping table; must stay the same so existing
  // deployments don't re-run migrations they already applied.
  const result = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
  );

  return result.rows[0].count;
}

describe("withMigrationLock", () => {
  let client: PGlite;
  let db: PgliteDatabase;
  let migrationsFolder: string;

  beforeEach(() => {
    client = new PGlite();
    db = drizzle(client);
    migrationsFolder = mkdtempSync(join(tmpdir(), "logwell-migrate-"));
    writeMigrations(migrationsFolder);
  });

  afterEach(async () => {
    await client.close();
    rmSync(migrationsFolder, { recursive: true, force: true });
  });

  it("holds the advisory lock while migrating and releases it afterwards", async () => {
    let locksDuringRun = -1;

    await withMigrationLock(db, async () => {
      locksDuringRun = await heldMigrationLocks(db);
      await migrate(db, { migrationsFolder });
    });

    expect(locksDuringRun).toBe(1);
    expect(await heldMigrationLocks(db)).toBe(0);
    expect(await appliedMigrations(db)).toBe(2);
  });

  it("is a no-op when every migration is already recorded", async () => {
    await withMigrationLock(db, () => migrate(db, { migrationsFolder }));
    await withMigrationLock(db, () => migrate(db, { migrationsFolder }));

    expect(await appliedMigrations(db)).toBe(2);
  });

  it("releases the lock and rethrows when a migration fails", async () => {
    const failure = new Error("boom");

    await expect(
      withMigrationLock(db, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(await heldMigrationLocks(db)).toBe(0);
  });
});
