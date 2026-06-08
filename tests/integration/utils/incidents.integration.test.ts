import type { PgliteDatabase } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type * as schema from "../../../src/lib/server/db/schema";
import { incident } from "../../../src/lib/server/db/schema";
import { setupTestDatabase } from "../../../src/lib/server/db/test-db";
import {
  type PreparedIncidentLog,
  upsertIncidentsForPreparedLogs,
} from "../../../src/lib/server/utils/incidents";
import { seedProject } from "../../fixtures/db";

describe("upsertIncidentsForPreparedLogs", () => {
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

  it("updates incident lastSeen and totalEvents on matching log", async () => {
    const project = await seedProject(db);

    await db.insert(incident).values({
      id: "inc-existing",
      projectId: project.id,
      fingerprint: "fp-existing",
      title: "Database timeout",
      normalizedMessage: "database timeout",
      serviceName: "api",
      sourceFile: "src/db.ts",
      lineNumber: 42,
      highestLevel: "error",
      firstSeen: new Date("2026-02-12T10:00:00.000Z"),
      lastSeen: new Date("2026-02-12T10:00:00.000Z"),
      totalEvents: 1,
    });

    const preparedLog: PreparedIncidentLog = {
      level: "error",
      message: "Database timeout",
      timestamp: new Date("2026-02-12T13:30:00.000Z"),
      sourceFile: "src/db.ts",
      lineNumber: 42,
      resourceAttributes: { "service.name": "api" },
      metadata: {},
      serviceName: "api",
      fingerprint: "fp-existing",
      normalizedMessage: "database timeout",
      incidentTitle: "Database timeout",
      incidentId: null,
    };

    const { touchedIncidents } = await upsertIncidentsForPreparedLogs(db, project.id, [
      preparedLog,
    ]);

    expect(touchedIncidents).toHaveLength(1);
    expect(touchedIncidents[0]!.totalEvents).toBe(2);
    expect(touchedIncidents[0]!.lastSeen).toEqual(new Date("2026-02-12T13:30:00.000Z"));
    expect(touchedIncidents[0]!.firstSeen).toEqual(new Date("2026-02-12T10:00:00.000Z"));
  });
});
