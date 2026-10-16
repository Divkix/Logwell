import { asc, eq } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type * as schema from "#lib/server/db/schema.js";
import { project } from "#lib/server/db/schema.js";
import { setupTestDatabase } from "#lib/server/db/test-db.js";
import {
  isCappedLogCount,
  oldestLogColumn,
  projectLogStatsColumns,
  recentLevelCounts,
} from "#lib/server/utils/capped-count.js";
import { seedLog, seedLogs, seedProject } from "../../fixtures/db";

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

describe("bounded per-project log stats", () => {
  let db: PgliteDatabase<typeof schema>;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ db, cleanup } = await setupTestDatabase());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("projectLogStatsColumns", () => {
    it("counts and dates each project's own logs, stopping at the ceiling", async () => {
      const busy = await seedProject(db, { name: "busy" });
      const quiet = await seedProject(db, { name: "quiet", ownerId: busy.ownerId });
      await seedProject(db, { name: "empty", ownerId: busy.ownerId });
      const oldest = await seedLog(db, busy.id, { timestamp: minutesAgo(20) });
      await seedLogs(db, busy.id, 4, { timestamp: minutesAgo(10) });
      const newest = await seedLog(db, busy.id, { timestamp: minutesAgo(1) });
      const only = await seedLog(db, quiet.id, { timestamp: minutesAgo(30) });

      const rows = await db
        .select({ name: project.name, ...projectLogStatsColumns(3), oldest: oldestLogColumn() })
        .from(project)
        .where(eq(project.ownerId, busy.ownerId))
        .orderBy(asc(project.name));

      // Distinct per-project values also prove the subqueries bind to the outer project row
      // (an unqualified "id" would bind to log.id and match nothing).
      expect(
        rows.map((r) => ({
          name: r.name,
          logCount: r.logCount,
          capped: isCappedLogCount(r.logCount, 3),
          lastActivity: r.lastActivity?.getTime() ?? null,
          oldest: r.oldest?.getTime() ?? null,
        })),
      ).toEqual([
        {
          name: "busy",
          logCount: 3,
          capped: true,
          lastActivity: newest.timestamp.getTime(),
          oldest: oldest.timestamp.getTime(),
        },
        { name: "empty", logCount: 0, capped: false, lastActivity: null, oldest: null },
        {
          name: "quiet",
          logCount: 1,
          capped: false,
          lastActivity: only.timestamp.getTime(),
          oldest: only.timestamp.getTime(),
        },
      ]);
      expect(rows[0]!.lastActivity).toBeInstanceOf(Date);
    });
  });

  describe("recentLevelCounts", () => {
    it("is exact below the ceiling", async () => {
      const proj = await seedProject(db);
      await seedLogs(db, proj.id, 2, { level: "info" });
      await seedLogs(db, proj.id, 1, { level: "error" });

      await expect(recentLevelCounts(db, proj.id, 10)).resolves.toEqual({
        total: 3,
        capped: false,
        levelCounts: { info: 2, error: 1 },
      });
    });

    it("describes only the most recent logs once capped", async () => {
      const proj = await seedProject(db);
      const other = await seedProject(db);
      await seedLogs(db, proj.id, 4, { level: "debug", timestamp: minutesAgo(60) });
      await seedLogs(db, proj.id, 2, { level: "fatal", timestamp: minutesAgo(1) });
      await seedLogs(db, other.id, 5, { level: "warn", timestamp: minutesAgo(0) });

      await expect(recentLevelCounts(db, proj.id, 3)).resolves.toEqual({
        total: 3,
        capped: true,
        levelCounts: { fatal: 2, debug: 1 },
      });
    });

    it("returns zeros for a project without logs", async () => {
      const proj = await seedProject(db);

      await expect(recentLevelCounts(db, proj.id)).resolves.toEqual({
        total: 0,
        capped: false,
        levelCounts: {},
      });
    });
  });
});
