import { eq } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type * as schema from "../db/schema";
import { incident, project, user } from "../db/schema";
import { setupTestDatabase } from "../db/test-db";
import { hashApiKey } from "./api-key";
import { type PreparedIncidentLog, upsertIncidentsForPreparedLogs } from "./incidents";

describe("upsertIncidentsForPreparedLogs", () => {
  let db: PgliteDatabase<typeof schema>;
  let cleanup: () => Promise<void>;
  let projectId: string;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;

    const ownerId = nanoid();
    projectId = nanoid();

    await db.insert(user).values({
      id: ownerId,
      name: "Test User",
      email: `${ownerId}@example.com`,
      emailVerified: false,
    });

    await db.insert(project).values({
      id: projectId,
      name: `project-${projectId}`,
      apiKeyHash: hashApiKey(`lw_${nanoid(32)}`),
      ownerId,
    });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("updates firstSeen when a later batch contains older logs", async () => {
    const fingerprint = "fp-out-of-order";

    const recentLog: PreparedIncidentLog = {
      level: "error",
      message: "Database timeout",
      timestamp: new Date("2026-03-02T12:00:00.000Z"),
      sourceFile: "src/db.ts",
      lineNumber: 42,
      resourceAttributes: null,
      metadata: null,
      serviceName: "api",
      fingerprint,
      normalizedMessage: "database timeout",
      incidentTitle: "Database timeout",
      incidentId: null,
    };

    const olderLog: PreparedIncidentLog = {
      ...recentLog,
      timestamp: new Date("2026-03-01T12:00:00.000Z"),
    };

    await upsertIncidentsForPreparedLogs(db, projectId, [recentLog]);
    await upsertIncidentsForPreparedLogs(db, projectId, [olderLog]);

    const [updatedIncident] = await db
      .select()
      .from(incident)
      .where(eq(incident.projectId, projectId));

    expect(updatedIncident).toBeDefined();
    expect(updatedIncident!.firstSeen.toISOString()).toBe("2026-03-01T12:00:00.000Z");
    expect(updatedIncident!.lastSeen.toISOString()).toBe("2026-03-02T12:00:00.000Z");
    expect(updatedIncident!.totalEvents).toBe(2);
  });
});
