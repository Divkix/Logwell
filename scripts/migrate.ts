#!/usr/bin/env tsx
import { fileURLToPath, pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Session-level advisory lock key shared by every Logwell process ("LWMG"). Replicas booting
 * together queue on it: the first applies pending migrations, the rest then find nothing to do.
 */
export const MIGRATION_LOCK_KEY = 0x4c574d47;

/** Same folder `drizzle-kit migrate` read (its `out` default) — the committed `drizzle/` SQL. */
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

/**
 * Run `runMigrations` while holding the migration advisory lock. Session-level advisory locks
 * belong to one connection, so `db` must be backed by a single connection.
 */
export async function withMigrationLock<T>(
  db: PgDatabase<PgQueryResultHKT>,
  runMigrations: () => Promise<T>,
): Promise<T> {
  await db.execute(sql.raw(`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`));

  try {
    return await runMigrations();
  } finally {
    await db.execute(sql.raw(`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`));
  }
}

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL;

  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  // max: 1 keeps the lock, the migrator's transaction and the unlock on one connection.
  const client = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });

  try {
    const db = drizzle(client);
    // No migrationsTable/migrationsSchema: drizzle-orm's defaults (drizzle.__drizzle_migrations)
    // are what drizzle-kit migrate passed through, so already-applied migrations are recognised.
    await withMigrationLock(db, () => migrate(db, { migrationsFolder: MIGRATIONS_FOLDER }));
    console.log("✓ Migrations applied");
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
  });
}
