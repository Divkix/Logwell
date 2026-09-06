import { asc, eq } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type * as schema from "../../../src/lib/server/db/schema";
import { log } from "../../../src/lib/server/db/schema";
import { setupTestDatabase } from "../../../src/lib/server/db/test-db";
import { cleanupOldLogs } from "../../../src/lib/server/jobs/log-cleanup";
import { seedLog, seedLogs, seedProject } from "../../fixtures/db";

describe("cleanupOldLogs", () => {
  let db: PgliteDatabase<typeof schema>;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
  });

  describe("effective retention calculation", () => {
    it("should use project retention_days when set", async () => {
      const project1 = await seedProject(db, { retentionDays: 7 });

      const now = new Date();
      const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
      const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

      await seedLogs(db, project1.id, 3, { timestamp: fiveDaysAgo });
      await seedLogs(db, project1.id, 3, { timestamp: tenDaysAgo });

      const result = await cleanupOldLogs(db);

      const remainingLogs = await db.select().from(log).where(eq(log.projectId, project1.id));
      expect(remainingLogs).toHaveLength(3);
      expect(result.totalLogsDeleted).toBe(3);
      expect(result.projectsProcessed).toBe(1);
      expect(result.projectsSkipped).toBe(0);
    });

    it("should use system default when project retention_days is null", async () => {
      const project1 = await seedProject(db, { retentionDays: null });

      const now = new Date();
      const twentyDaysAgo = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);
      const fortyDaysAgo = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);

      await seedLogs(db, project1.id, 2, { timestamp: twentyDaysAgo });
      await seedLogs(db, project1.id, 2, { timestamp: fortyDaysAgo });

      const result = await cleanupOldLogs(db);

      const remainingLogs = await db.select().from(log).where(eq(log.projectId, project1.id));
      expect(remainingLogs).toHaveLength(2);
      expect(result.totalLogsDeleted).toBe(2);
      expect(result.projectsProcessed).toBe(1);
    });

    it("should skip deletion when effective retention is 0", async () => {
      const project1 = await seedProject(db, { retentionDays: 0 });

      const now = new Date();
      const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

      await seedLogs(db, project1.id, 5, { timestamp: oneYearAgo });

      const result = await cleanupOldLogs(db);

      const remainingLogs = await db.select().from(log).where(eq(log.projectId, project1.id));
      expect(remainingLogs).toHaveLength(5);
      expect(result.totalLogsDeleted).toBe(0);
      expect(result.projectsProcessed).toBe(0);
      expect(result.projectsSkipped).toBe(1);
    });

    it("should skip deletion when system default is 0 and project is null", async () => {
      const project1 = await seedProject(db, { retentionDays: null });
      const project2 = await seedProject(db, { retentionDays: 0 });

      const now = new Date();
      const veryOld = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

      await seedLogs(db, project1.id, 3, { timestamp: veryOld });
      await seedLogs(db, project2.id, 3, { timestamp: veryOld });

      const result = await cleanupOldLogs(db);

      const project2Logs = await db.select().from(log).where(eq(log.projectId, project2.id));
      expect(project2Logs).toHaveLength(3); // Not deleted
      expect(result.projectsSkipped).toBeGreaterThanOrEqual(1);
    });
  });

  describe("log deletion", () => {
    it("should delete logs older than retention period", async () => {
      const project1 = await seedProject(db, { retentionDays: 10 });

      const now = new Date();
      const fifteenDaysAgo = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);

      await seedLogs(db, project1.id, 8, { timestamp: fifteenDaysAgo });

      const result = await cleanupOldLogs(db);

      const remainingLogs = await db.select().from(log).where(eq(log.projectId, project1.id));
      expect(remainingLogs).toHaveLength(0);
      expect(result.totalLogsDeleted).toBe(8);
    });

    it("should NOT delete logs newer than retention period", async () => {
      const project1 = await seedProject(db, { retentionDays: 30 });

      const now = new Date();
      const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

      await seedLogs(db, project1.id, 5, { timestamp: tenDaysAgo });

      const result = await cleanupOldLogs(db);

      const remainingLogs = await db.select().from(log).where(eq(log.projectId, project1.id));
      expect(remainingLogs).toHaveLength(5);
      expect(result.totalLogsDeleted).toBe(0);
    });

    it("should handle multiple projects with different retention", async () => {
      const project1 = await seedProject(db, { retentionDays: 7 });
      const project2 = await seedProject(db, { retentionDays: 30 });
      const project3 = await seedProject(db, { retentionDays: 0 });

      const now = new Date();
      const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
      const fortyDaysAgo = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);

      await seedLogs(db, project1.id, 3, { timestamp: tenDaysAgo });

      await seedLogs(db, project2.id, 2, { timestamp: tenDaysAgo });
      await seedLogs(db, project2.id, 2, { timestamp: fortyDaysAgo });

      await seedLogs(db, project3.id, 5, { timestamp: fortyDaysAgo });

      const result = await cleanupOldLogs(db);

      const p1Logs = await db.select().from(log).where(eq(log.projectId, project1.id));
      expect(p1Logs).toHaveLength(0); // All deleted

      const p2Logs = await db.select().from(log).where(eq(log.projectId, project2.id));
      expect(p2Logs).toHaveLength(2); // Only 10-day-old kept

      const p3Logs = await db.select().from(log).where(eq(log.projectId, project3.id));
      expect(p3Logs).toHaveLength(5); // All kept

      expect(result.totalLogsDeleted).toBe(5); // 3 from p1, 2 from p2
      expect(result.projectsProcessed).toBe(2); // p1 and p2
      expect(result.projectsSkipped).toBe(1); // p3
    });

    it("should batch delete in chunks of 1000", async () => {
      const project1 = await seedProject(db, { retentionDays: 7 });

      const now = new Date();
      const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

      await seedLogs(db, project1.id, 1000, { timestamp: tenDaysAgo });
      await seedLogs(db, project1.id, 1000, { timestamp: tenDaysAgo });
      await seedLogs(db, project1.id, 500, { timestamp: tenDaysAgo });

      const result = await cleanupOldLogs(db);

      const remainingLogs = await db.select().from(log).where(eq(log.projectId, project1.id));
      expect(remainingLogs).toHaveLength(0);
      expect(result.totalLogsDeleted).toBe(2500);
    });

    it("should handle projects with no logs", async () => {
      const project1 = await seedProject(db, { retentionDays: 30 });
      await seedProject(db, { retentionDays: 7 });

      const now = new Date();
      const fortyDaysAgo = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);
      await seedLogs(db, project1.id, 3, { timestamp: fortyDaysAgo });

      const result = await cleanupOldLogs(db);

      expect(result.totalLogsDeleted).toBe(3);
      expect(result.projectsProcessed).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it("should handle empty database", async () => {
      const result = await cleanupOldLogs(db);

      expect(result.totalLogsDeleted).toBe(0);
      expect(result.projectsProcessed).toBe(0);
      expect(result.projectsSkipped).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("edge cases", () => {
    it("should handle logs exactly at retention boundary", async () => {
      const project1 = await seedProject(db, { retentionDays: 30 });

      const now = new Date();
      const exactlyThirtyDays = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const thirtyDaysAndOneSecond = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000 + 1000));
      const twentyNineDays = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);

      await seedLogs(db, project1.id, 2, { timestamp: exactlyThirtyDays });
      await seedLogs(db, project1.id, 2, { timestamp: thirtyDaysAndOneSecond });
      await seedLogs(db, project1.id, 2, { timestamp: twentyNineDays });

      const result = await cleanupOldLogs(db);

      const remainingLogs = await db.select().from(log).where(eq(log.projectId, project1.id));

      expect(remainingLogs.length).toBeGreaterThanOrEqual(2);
      expect(remainingLogs.length).toBeLessThanOrEqual(4);
      expect(result.totalLogsDeleted).toBeGreaterThanOrEqual(2);
      expect(result.totalLogsDeleted).toBeLessThanOrEqual(4);
    });
  });
});

describe("cleanupOldLogs batch selection", () => {
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

  it("deletes only logs older than retention, keeping the most recent", async () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const project1 = await seedProject(db, { retentionDays: 7 });

    const now = new Date();
    for (const days of [12, 10, 8, 5, 3, 1]) {
      await seedLog(db, project1.id, {
        message: `log-${days}d`,
        timestamp: new Date(now.getTime() - days * DAY_MS),
      });
    }

    const result = await cleanupOldLogs(db);

    expect(result.errors).toEqual([]);
    expect(result.totalLogsDeleted).toBe(3);

    const remaining = await db
      .select()
      .from(log)
      .where(eq(log.projectId, project1.id))
      .orderBy(asc(log.timestamp));

    expect(remaining.map((l) => l.message)).toEqual(["log-5d", "log-3d", "log-1d"]);

    const cutoff = new Date(now.getTime() - 7 * DAY_MS);
    for (const row of remaining) {
      expect(row.timestamp.getTime()).toBeGreaterThanOrEqual(cutoff.getTime());
    }
  });

  it("deletes the correct logs per project when retention differs", async () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const project1 = await seedProject(db, { retentionDays: 7 });
    const project2 = await seedProject(db, { retentionDays: 30 });

    const now = new Date();
    const tenDaysAgo = new Date(now.getTime() - 10 * DAY_MS);
    const fortyDaysAgo = new Date(now.getTime() - 40 * DAY_MS);

    await seedLog(db, project1.id, { message: "p1-old", timestamp: tenDaysAgo });
    await seedLog(db, project1.id, { message: "p1-fresh", timestamp: now });
    await seedLog(db, project2.id, { message: "p2-recent", timestamp: tenDaysAgo });
    await seedLog(db, project2.id, { message: "p2-old", timestamp: fortyDaysAgo });

    const result = await cleanupOldLogs(db);

    expect(result.errors).toEqual([]);
    expect(result.totalLogsDeleted).toBe(2);

    const p1Remaining = await db.select().from(log).where(eq(log.projectId, project1.id));
    expect(p1Remaining.map((l) => l.message)).toEqual(["p1-fresh"]);

    const p2Remaining = await db.select().from(log).where(eq(log.projectId, project2.id));
    expect(p2Remaining.map((l) => l.message)).toEqual(["p2-recent"]);
  });
});
