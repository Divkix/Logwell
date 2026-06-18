import { eq } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type * as schema from "$lib/server/db/schema";
import { log } from "$lib/server/db/schema";
import { setupTestDatabase } from "$lib/server/db/test-db";
import { cappedLogCount, LOG_COUNT_CEILING } from "$lib/server/utils/capped-count";
import { seedLogs, seedProject } from "../../fixtures/db";

describe("cappedLogCount", () => {
  let db: PgliteDatabase<typeof schema>;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("returns the exact count and capped=false below the ceiling", async () => {
    const project = await seedProject(db);
    await seedLogs(db, project.id, 3);

    const result = await cappedLogCount(db, eq(log.projectId, project.id));

    expect(result.total).toBe(3);
    expect(result.capped).toBe(false);
  });

  it("caps the count and sets capped=true once the ceiling is reached", async () => {
    const project = await seedProject(db);
    await seedLogs(db, project.id, 3);

    // Use a tiny ceiling to exercise the cap without seeding LOG_COUNT_CEILING rows.
    const result = await cappedLogCount(db, eq(log.projectId, project.id), 2);

    expect(result.total).toBe(2); // LIMIT 2 inside the subquery stops the scan
    expect(result.capped).toBe(true);
  });

  it("returns total=0, capped=false when nothing matches", async () => {
    const project = await seedProject(db);
    await seedLogs(db, project.id, 1);

    const result = await cappedLogCount(db, eq(log.projectId, "does-not-exist"), 2);

    expect(result.total).toBe(0);
    expect(result.capped).toBe(false);
  });

  it("defaults the ceiling to LOG_COUNT_CEILING", async () => {
    const project = await seedProject(db);
    await seedLogs(db, project.id, 5);

    // Default ceiling is 10_000, far above 5 → exact count, not capped.
    const result = await cappedLogCount(db, eq(log.projectId, project.id));

    expect(LOG_COUNT_CEILING).toBe(10_000);
    expect(result.total).toBe(5);
    expect(result.capped).toBe(false);
  });
});
