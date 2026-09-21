import { eq } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type * as schema from "../../../src/lib/server/db/schema";
import { incident, log } from "../../../src/lib/server/db/schema";
import { setupTestDatabase } from "../../../src/lib/server/db/test-db";
import { backfillProjectIncidents } from "../../../src/lib/server/utils/incident-backfill";
import { buildIncidentFingerprint } from "../../../src/lib/server/utils/incident-fingerprint";
import { createLogFactory, seedLog, seedProject } from "../../fixtures/db";

// LOG_BATCH_SIZE in incident-backfill.ts is 1000, so this many logs force the keyset pager
// through a second batch: assignment and counters must still cover the whole window.
const LOG_COUNT = 1200;
const HALF = LOG_COUNT / 2;
const MINUTE = 60_000;

describe("backfillProjectIncidents batching", () => {
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

  it("assigns and recomputes incidents across batch boundaries", async () => {
    const project = await seedProject(db);
    const base = new Date("2026-01-01T00:00:00.000Z");
    const since = new Date(base.getTime() - MINUTE);

    const logs = Array.from({ length: LOG_COUNT }, (_, index) =>
      createLogFactory({
        projectId: project.id,
        level: "error",
        message: index % 2 === 0 ? "Error A" : "Error B",
        timestamp: new Date(base.getTime() + index * MINUTE),
      }),
    );
    await db.insert(log).values(logs);

    const result = await backfillProjectIncidents(db, project.id, since);

    expect(result.processedLogs).toBe(LOG_COUNT);
    expect(result.updatedLogs).toBe(LOG_COUNT);
    // One incident per fingerprint, not one per batch.
    expect(result.touchedIncidents).toBe(2);

    const rows = await db.select().from(log).where(eq(log.projectId, project.id));
    expect(rows.every((row) => row.incidentId !== null && row.fingerprint !== null)).toBe(true);

    const incidents = await db.select().from(incident).where(eq(incident.projectId, project.id));
    expect(incidents).toHaveLength(2);

    // "Error A" owns the even indexes (0..LOG_COUNT-2), "Error B" the odd ones.
    const incidentByFirstSeen = new Map(incidents.map((row) => [row.firstSeen.getTime(), row]));
    const expected = [
      { firstSeen: base.getTime(), lastSeen: base.getTime() + (LOG_COUNT - 2) * MINUTE },
      { firstSeen: base.getTime() + MINUTE, lastSeen: base.getTime() + (LOG_COUNT - 1) * MINUTE },
    ];

    for (const { firstSeen, lastSeen } of expected) {
      const entry = incidentByFirstSeen.get(firstSeen);
      expect(entry).toBeDefined();
      // lastSeen lives in the final batch, so the counter must have been recomputed there.
      expect(entry?.lastSeen.getTime()).toBe(lastSeen);
      expect(entry?.totalEvents).toBe(HALF);
      expect(rows.filter((row) => row.incidentId === entry?.id)).toHaveLength(HALF);
    }

    const rerun = await backfillProjectIncidents(db, project.id, since);
    expect(rerun.updatedLogs).toBe(0);
    expect(rerun.touchedIncidents).toBe(2);

    const afterRerun = await db.select().from(incident).where(eq(incident.projectId, project.id));
    expect(afterRerun.map((row) => row.id).sort()).toEqual(incidents.map((row) => row.id).sort());
    expect(afterRerun.every((row) => row.totalEvents === HALF)).toBe(true);
  });

  it("recomputes counters from every assigned log, not just the backfill window", async () => {
    const project = await seedProject(db);
    const now = new Date("2026-02-01T12:00:00.000Z");
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const older = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

    const { fingerprint, normalizedMessage } = buildIncidentFingerprint({
      message: "Queue overflow",
      serviceName: null,
      sourceFile: null,
      lineNumber: null,
    });

    const incidentId = nanoid();
    await db.insert(incident).values({
      id: incidentId,
      projectId: project.id,
      fingerprint,
      title: "Queue overflow",
      normalizedMessage,
      highestLevel: "error",
      firstSeen: older,
      lastSeen: older,
      totalEvents: 1,
    });

    await seedLog(db, project.id, {
      level: "error",
      message: "Queue overflow",
      timestamp: older,
      incidentId,
      fingerprint,
    });
    await seedLog(db, project.id, {
      level: "error",
      message: "Queue overflow",
      timestamp: now,
    });

    const result = await backfillProjectIncidents(db, project.id, since);
    expect(result.processedLogs).toBe(1);
    expect(result.updatedLogs).toBe(1);
    expect(result.touchedIncidents).toBe(1);

    const [updated] = await db.select().from(incident).where(eq(incident.id, incidentId));
    expect(updated?.id).toBe(incidentId);
    expect(updated?.totalEvents).toBe(2);
    expect(updated?.firstSeen.getTime()).toBe(older.getTime());
    expect(updated?.lastSeen.getTime()).toBe(now.getTime());
  });
});
