import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type * as schema from "../../../src/lib/server/db/schema";
import { incident, log } from "../../../src/lib/server/db/schema";
import { setupTestDatabase } from "../../../src/lib/server/db/test-db";
import { cleanupOldLogs } from "../../../src/lib/server/jobs/log-cleanup";
import { seedLog, seedLogs, seedProject } from "../../fixtures/db";

describe("cleanupOldLogs", () => {
  let db: PgliteDatabase<typeof schema>;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
  });

  afterEach(() => cleanup());

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

describe("cleanupOldLogs pacing", () => {
  let db: PgliteDatabase<typeof schema>;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ db, cleanup } = await setupTestDatabase());
  });

  afterEach(() => cleanup());

  const tenDaysAgo = () => new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

  it("pauses between batches, not after the last one", async () => {
    const project1 = await seedProject(db, { retentionDays: 7 });
    await seedLogs(db, project1.id, 5, { timestamp: tenDaysAgo() });
    const sleep = vi.fn(async () => {});

    const result = await cleanupOldLogs(db, { batchSize: 2, batchPauseMs: 250, sleep });

    expect(result.totalLogsDeleted).toBe(5);
    // Batches of 2, 2, 1: the short third batch ends the loop without another pause.
    expect(sleep.mock.calls).toEqual([[250], [250]]);
  });

  it("stops after a short batch instead of issuing an empty one", async () => {
    const project1 = await seedProject(db, { retentionDays: 7 });
    await seedLogs(db, project1.id, 3, { timestamp: tenDaysAgo() });
    const executeSpy = vi.spyOn(db, "execute");

    await cleanupOldLogs(db, { batchSize: 2, batchPauseMs: 0 });

    // Two log batches (2, then a short 1), then one incident-prune batch.
    expect(executeSpy).toHaveBeenCalledTimes(3);
  });

  it("runs batches back-to-back when the pause is 0", async () => {
    const project1 = await seedProject(db, { retentionDays: 7 });
    await seedLogs(db, project1.id, 4, { timestamp: tenDaysAgo() });
    const sleep = vi.fn(async () => {});

    const result = await cleanupOldLogs(db, { batchSize: 2, batchPauseMs: 0, sleep });

    expect(result.totalLogsDeleted).toBe(4);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("cleanupOldLogs incident pruning", () => {
  let db: PgliteDatabase<typeof schema>;
  let cleanup: () => Promise<void>;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

  beforeEach(async () => {
    ({ db, cleanup } = await setupTestDatabase());
  });

  afterEach(() => cleanup());

  async function seedIncident(projectId: string, lastSeen: Date): Promise<string> {
    const id = nanoid();

    await db.insert(incident).values({
      id,
      projectId,
      fingerprint: `fp-${id}`,
      title: "Database timeout",
      normalizedMessage: "database timeout",
      highestLevel: "error",
      firstSeen: lastSeen,
      lastSeen,
      totalEvents: 1,
    });

    return id;
  }

  const remainingIncidentIds = async (projectId: string) =>
    (await db.select({ id: incident.id }).from(incident).where(eq(incident.projectId, projectId)))
      .map((row) => row.id)
      .sort();

  it("deletes incidents past retention once their logs are gone", async () => {
    const proj = await seedProject(db, { retentionDays: 7 });
    const expired = await seedIncident(proj.id, daysAgo(10));
    const recent = await seedIncident(proj.id, daysAgo(1));
    await seedLog(db, proj.id, { level: "error", incidentId: expired, timestamp: daysAgo(10) });
    await seedLog(db, proj.id, { level: "error", incidentId: recent, timestamp: daysAgo(1) });

    const result = await cleanupOldLogs(db);

    expect(result.totalLogsDeleted).toBe(1);
    expect(result.totalIncidentsDeleted).toBe(1);
    expect(await remainingIncidentIds(proj.id)).toEqual([recent]);
  });

  it("keeps an expired incident that still owns a log", async () => {
    const proj = await seedProject(db, { retentionDays: 7 });
    const stale = await seedIncident(proj.id, daysAgo(10));
    // A late event inside retention that never bumped last_seen (e.g. written by a backfill).
    await seedLog(db, proj.id, { level: "error", incidentId: stale, timestamp: daysAgo(2) });

    const result = await cleanupOldLogs(db);

    expect(result.totalIncidentsDeleted).toBe(0);
    expect(await remainingIncidentIds(proj.id)).toEqual([stale]);
  });

  it("never prunes incidents of a project that keeps logs forever", async () => {
    const proj = await seedProject(db, { retentionDays: 0 });
    const ancient = await seedIncident(proj.id, daysAgo(400));

    const result = await cleanupOldLogs(db);

    expect(result.totalIncidentsDeleted).toBe(0);
    expect(await remainingIncidentIds(proj.id)).toEqual([ancient]);
  });

  it("applies the system default retention when the project has none", async () => {
    // RETENTION_CONFIG.LOG_RETENTION_DAYS defaults to 30.
    const proj = await seedProject(db, { retentionDays: null });
    await seedIncident(proj.id, daysAgo(40));
    const withinDefault = await seedIncident(proj.id, daysAgo(20));

    const result = await cleanupOldLogs(db);

    expect(result.totalIncidentsDeleted).toBe(1);
    expect(result.projectsProcessed).toBe(1);
    expect(await remainingIncidentIds(proj.id)).toEqual([withinDefault]);
  });

  it("prunes in batches and leaves other projects alone", async () => {
    const proj = await seedProject(db, { retentionDays: 7 });
    const other = await seedProject(db, { retentionDays: 0 });

    for (let i = 0; i < 5; i++) await seedIncident(proj.id, daysAgo(10 + i));
    const otherIncident = await seedIncident(other.id, daysAgo(10));
    const sleep = vi.fn(async () => {});

    const result = await cleanupOldLogs(db, { batchSize: 2, batchPauseMs: 10, sleep });

    expect(result.totalIncidentsDeleted).toBe(5);
    expect(await remainingIncidentIds(proj.id)).toEqual([]);
    expect(await remainingIncidentIds(other.id)).toEqual([otherIncident]);
    // Incident batches of 2, 2, 1 pause twice; the empty log pass never pauses.
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});
