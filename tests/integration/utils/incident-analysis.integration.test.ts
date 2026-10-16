import type { PgliteDatabase } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type * as schema from "#lib/server/db/schema.js";
import { incident } from "#lib/server/db/schema.js";
import { setupTestDatabase } from "#lib/server/db/test-db.js";
import { analyzeRecentIncidentEvents } from "#lib/server/utils/incident-analysis.js";
import { seedLogs, seedProject } from "../../fixtures/db";

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

describe("analyzeRecentIncidentEvents", () => {
  let db: PgliteDatabase<typeof schema>;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ db, cleanup } = await setupTestDatabase());
  });

  afterEach(async () => {
    await cleanup();
  });

  async function seedIncident(projectId: string, id: string) {
    await db.insert(incident).values({
      id,
      projectId,
      fingerprint: `fp-${id}`,
      title: "Database timeout",
      normalizedMessage: "database timeout",
      highestLevel: "error",
      firstSeen: minutesAgo(120),
      lastSeen: minutesAgo(1),
      totalEvents: 0,
    });
  }

  it("ranks sources, request ids and trace ids over the incident's events", async () => {
    const proj = await seedProject(db);
    await seedIncident(proj.id, "inc-a");
    await seedIncident(proj.id, "inc-b");

    const base = { level: "error" as const, incidentId: "inc-a" };
    await seedLogs(db, proj.id, 3, {
      ...base,
      sourceFile: "db.ts",
      lineNumber: 10,
      requestId: "req-1",
      traceId: "trace-1",
    });
    await seedLogs(db, proj.id, 1, { ...base, sourceFile: "api.ts", lineNumber: 7, requestId: "" });
    // Another incident in the same project must not leak in.
    await seedLogs(db, proj.id, 5, { level: "error", incidentId: "inc-b", sourceFile: "x.ts" });

    await expect(analyzeRecentIncidentEvents(db, proj.id, "inc-a")).resolves.toEqual({
      analyzedEvents: 4,
      rootCauseCandidates: [
        { sourceFile: "db.ts", lineNumber: 10, count: 3 },
        { sourceFile: "api.ts", lineNumber: 7, count: 1 },
      ],
      correlations: {
        topRequestIds: [{ requestId: "req-1", count: 3 }],
        topTraceIds: [{ traceId: "trace-1", count: 3 }],
      },
    });
  });

  it("aggregates only the most recent events once over the limit", async () => {
    const proj = await seedProject(db);
    await seedIncident(proj.id, "inc-a");
    await seedLogs(db, proj.id, 5, {
      level: "error",
      incidentId: "inc-a",
      sourceFile: "old.ts",
      lineNumber: 1,
      timestamp: minutesAgo(60),
    });
    await seedLogs(db, proj.id, 2, {
      level: "error",
      incidentId: "inc-a",
      sourceFile: "new.ts",
      lineNumber: 2,
      timestamp: minutesAgo(1),
    });

    const analysis = await analyzeRecentIncidentEvents(db, proj.id, "inc-a", 3);

    expect(analysis.analyzedEvents).toBe(3);
    expect(analysis.rootCauseCandidates).toEqual([
      { sourceFile: "new.ts", lineNumber: 2, count: 2 },
      { sourceFile: "old.ts", lineNumber: 1, count: 1 },
    ]);
  });

  it("returns empty rankings for an incident without stored logs", async () => {
    const proj = await seedProject(db);
    await seedIncident(proj.id, "inc-a");

    await expect(analyzeRecentIncidentEvents(db, proj.id, "inc-a")).resolves.toEqual({
      analyzedEvents: 0,
      rootCauseCandidates: [],
      correlations: { topRequestIds: [], topTraceIds: [] },
    });
  });
});
