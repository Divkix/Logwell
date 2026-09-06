import { and, eq } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import * as schema from "$lib/server/db/schema";
import { setupTestDatabase } from "$lib/server/db/test-db";
import {
  type PreparedIncidentLog,
  upsertIncidentsForPreparedLogs,
} from "$lib/server/utils/incidents";
import { seedProject } from "../../fixtures/db";

describe("Incident upsert race condition", () => {
  let db: PgliteDatabase<typeof schema>;
  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
  });

  it("handles concurrent upserts for the same new fingerprint without error", async () => {
    const project = await seedProject(db);
    const now = new Date();

    const logsA: PreparedIncidentLog[] = [
      {
        level: "error",
        message: "Database connection timeout",
        timestamp: now,
        sourceFile: "src/db.ts",
        lineNumber: 42,
        resourceAttributes: null,
        metadata: null,
        serviceName: "api",
        fingerprint: "db-timeout-fp",
        normalizedMessage: "database connection timeout",
        incidentTitle: "Database connection timeout",
        incidentId: null,
      },
    ];

    const logsB: PreparedIncidentLog[] = [
      {
        level: "error",
        message: "Database connection timeout (retry)",
        timestamp: new Date(now.getTime() + 1000),
        sourceFile: "src/db.ts",
        lineNumber: 42,
        resourceAttributes: null,
        metadata: null,
        serviceName: "api",
        fingerprint: "db-timeout-fp",
        normalizedMessage: "database connection timeout",
        incidentTitle: "Database connection timeout (retry)",
        incidentId: null,
      },
    ];

    const [resultA, resultB] = await Promise.all([
      upsertIncidentsForPreparedLogs(db, project.id, logsA),
      upsertIncidentsForPreparedLogs(db, project.id, logsB),
    ]);

    expect(resultA.touchedIncidents).toHaveLength(1);
    expect(resultB.touchedIncidents).toHaveLength(1);

    const allIncidents = await db
      .select()
      .from(schema.incident)
      .where(
        and(
          eq(schema.incident.projectId, project.id),
          eq(schema.incident.fingerprint, "db-timeout-fp"),
        ),
      );

    expect(allIncidents).toHaveLength(1);
    const incidentRow = allIncidents[0]!;

    expect(incidentRow.totalEvents).toBe(2);

    expect(incidentRow.lastSeen.getTime()).toBeGreaterThanOrEqual(now.getTime() + 1000);
  });

  it("handles concurrent upsert when one batch has multiple new fingerprints", async () => {
    const project = await seedProject(db);
    const now = new Date();

    const logsA: PreparedIncidentLog[] = [
      {
        level: "error",
        message: "Error A",
        timestamp: now,
        sourceFile: "src/a.ts",
        lineNumber: 1,
        resourceAttributes: null,
        metadata: null,
        serviceName: "svc-a",
        fingerprint: "fp-a",
        normalizedMessage: "error a",
        incidentTitle: "Error A",
        incidentId: null,
      },
    ];

    const logsB: PreparedIncidentLog[] = [
      {
        level: "fatal",
        message: "Error B",
        timestamp: new Date(now.getTime() + 500),
        sourceFile: "src/b.ts",
        lineNumber: 2,
        resourceAttributes: null,
        metadata: null,
        serviceName: "svc-b",
        fingerprint: "fp-b",
        normalizedMessage: "error b",
        incidentTitle: "Error B",
        incidentId: null,
      },
    ];

    const [resultA, resultB] = await Promise.all([
      upsertIncidentsForPreparedLogs(db, project.id, logsA),
      upsertIncidentsForPreparedLogs(db, project.id, logsB),
    ]);

    expect(resultA.touchedIncidents).toHaveLength(1);
    expect(resultB.touchedIncidents).toHaveLength(1);

    const allIncidents = await db
      .select()
      .from(schema.incident)
      .where(eq(schema.incident.projectId, project.id));

    expect(allIncidents).toHaveLength(2);
  });

  it("batches multiple distinct fingerprints in a single upsert call", async () => {
    const project = await seedProject(db);
    const now = new Date();

    const logs: PreparedIncidentLog[] = [
      {
        level: "error",
        message: "Cache miss",
        timestamp: now,
        sourceFile: "src/cache.ts",
        lineNumber: 10,
        resourceAttributes: null,
        metadata: null,
        serviceName: "cache-svc",
        fingerprint: "fp-cache",
        normalizedMessage: "cache miss",
        incidentTitle: "Cache miss",
        incidentId: null,
      },
      {
        level: "error",
        message: "DB timeout",
        timestamp: new Date(now.getTime() + 500),
        sourceFile: "src/db.ts",
        lineNumber: 20,
        resourceAttributes: null,
        metadata: null,
        serviceName: "db-svc",
        fingerprint: "fp-db",
        normalizedMessage: "db timeout",
        incidentTitle: "DB timeout",
        incidentId: null,
      },
      {
        level: "fatal",
        message: "Auth failure",
        timestamp: new Date(now.getTime() + 1000),
        sourceFile: "src/auth.ts",
        lineNumber: 30,
        resourceAttributes: null,
        metadata: null,
        serviceName: "auth-svc",
        fingerprint: "fp-auth",
        normalizedMessage: "auth failure",
        incidentTitle: "Auth failure",
        incidentId: null,
      },
      {
        level: "error",
        message: "Cache miss again",
        timestamp: new Date(now.getTime() + 1500),
        sourceFile: "src/cache.ts",
        lineNumber: 10,
        resourceAttributes: null,
        metadata: null,
        serviceName: "cache-svc",
        fingerprint: "fp-cache",
        normalizedMessage: "cache miss",
        incidentTitle: "Cache miss",
        incidentId: null,
      },
      {
        level: "error",
        message: "DB timeout again",
        timestamp: new Date(now.getTime() + 2000),
        sourceFile: "src/db.ts",
        lineNumber: 20,
        resourceAttributes: null,
        metadata: null,
        serviceName: "db-svc",
        fingerprint: "fp-db",
        normalizedMessage: "db timeout",
        incidentTitle: "DB timeout",
        incidentId: null,
      },
    ];

    const result = await upsertIncidentsForPreparedLogs(db, project.id, logs);

    expect(result.touchedIncidents).toHaveLength(3);
    expect(result.incidentByFingerprint.size).toBe(3);
    expect(result.incidentByFingerprint.has("fp-cache")).toBe(true);
    expect(result.incidentByFingerprint.has("fp-db")).toBe(true);
    expect(result.incidentByFingerprint.has("fp-auth")).toBe(true);

    const allIncidents = await db
      .select()
      .from(schema.incident)
      .where(eq(schema.incident.projectId, project.id));

    expect(allIncidents).toHaveLength(3);

    const cacheIncident = allIncidents.find((i) => i.fingerprint === "fp-cache")!;
    const dbIncident = allIncidents.find((i) => i.fingerprint === "fp-db")!;
    const authIncident = allIncidents.find((i) => i.fingerprint === "fp-auth")!;

    expect(cacheIncident.totalEvents).toBe(2);
    expect(dbIncident.totalEvents).toBe(2);
    expect(authIncident.totalEvents).toBe(1);

    expect(authIncident.highestLevel).toBe("fatal");
    expect(cacheIncident.highestLevel).toBe("error");

    expect(cacheIncident.lastSeen.getTime()).toBe(now.getTime() + 1500);
  });

  it("updates firstSeen when a later batch contains older logs", async () => {
    const project = await seedProject(db);
    const fingerprint = "fp-out-of-order";
    const base = {
      level: "error",
      message: "Database timeout",
      sourceFile: "src/db.ts",
      lineNumber: 42,
      resourceAttributes: null,
      metadata: null,
      serviceName: "api",
      fingerprint,
      normalizedMessage: "database timeout",
      incidentTitle: "Database timeout",
      incidentId: null,
    } as const;

    await upsertIncidentsForPreparedLogs(db, project.id, [
      { ...base, timestamp: new Date("2026-03-02T12:00:00.000Z") },
    ]);
    await upsertIncidentsForPreparedLogs(db, project.id, [
      { ...base, timestamp: new Date("2026-03-01T12:00:00.000Z") },
    ]);

    const allIncidents = await db
      .select()
      .from(schema.incident)
      .where(eq(schema.incident.projectId, project.id));

    expect(allIncidents).toHaveLength(1);
    expect(allIncidents[0]!.firstSeen.toISOString()).toBe("2026-03-01T12:00:00.000Z");
    expect(allIncidents[0]!.lastSeen.toISOString()).toBe("2026-03-02T12:00:00.000Z");
    expect(allIncidents[0]!.totalEvents).toBe(2);
  });
});
