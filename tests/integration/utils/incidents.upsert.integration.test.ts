import { and, eq } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import * as schema from '$lib/server/db/schema';
import { setupTestDatabase } from '$lib/server/db/test-db';
import {
  type PreparedIncidentLog,
  upsertIncidentsForPreparedLogs,
} from '$lib/server/utils/incidents';
import { seedProject } from '../../fixtures/db';

describe('Incident upsert race condition', () => {
  let db: PgliteDatabase<typeof schema>;
  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
  });

  it('handles concurrent upserts for the same new fingerprint without error', async () => {
    const project = await seedProject(db);
    const now = new Date();

    const logsA: PreparedIncidentLog[] = [
      {
        level: 'error',
        message: 'Database connection timeout',
        timestamp: now,
        sourceFile: 'src/db.ts',
        lineNumber: 42,
        resourceAttributes: null,
        metadata: null,
        serviceName: 'api',
        fingerprint: 'db-timeout-fp',
        normalizedMessage: 'database connection timeout',
        incidentTitle: 'Database connection timeout',
        incidentId: null,
      },
    ];

    const logsB: PreparedIncidentLog[] = [
      {
        level: 'error',
        message: 'Database connection timeout (retry)',
        timestamp: new Date(now.getTime() + 1000),
        sourceFile: 'src/db.ts',
        lineNumber: 42,
        resourceAttributes: null,
        metadata: null,
        serviceName: 'api',
        fingerprint: 'db-timeout-fp',
        normalizedMessage: 'database connection timeout',
        incidentTitle: 'Database connection timeout (retry)',
        incidentId: null,
      },
    ];

    // Fire both upserts concurrently — simulates two ingest requests
    // hitting the same new fingerprint at the same time.
    const [resultA, resultB] = await Promise.all([
      upsertIncidentsForPreparedLogs(db, project.id, logsA),
      upsertIncidentsForPreparedLogs(db, project.id, logsB),
    ]);

    // Both calls should return successfully
    expect(resultA.touchedIncidents).toHaveLength(1);
    expect(resultB.touchedIncidents).toHaveLength(1);

    // The incident should exist in the database
    const allIncidents = await db
      .select()
      .from(schema.incident)
      .where(
        and(
          eq(schema.incident.projectId, project.id),
          eq(schema.incident.fingerprint, 'db-timeout-fp'),
        ),
      );

    expect(allIncidents).toHaveLength(1);
    const incidentRow = allIncidents[0]!;

    // totalEvents should reflect the combined count from both batches
    expect(incidentRow.totalEvents).toBe(2);

    // lastSeen should be from the later batch
    expect(incidentRow.lastSeen.getTime()).toBeGreaterThanOrEqual(now.getTime() + 1000);
  });

  it('handles concurrent upsert when one batch has multiple new fingerprints', async () => {
    const project = await seedProject(db);
    const now = new Date();

    const logsA: PreparedIncidentLog[] = [
      {
        level: 'error',
        message: 'Error A',
        timestamp: now,
        sourceFile: 'src/a.ts',
        lineNumber: 1,
        resourceAttributes: null,
        metadata: null,
        serviceName: 'svc-a',
        fingerprint: 'fp-a',
        normalizedMessage: 'error a',
        incidentTitle: 'Error A',
        incidentId: null,
      },
    ];

    const logsB: PreparedIncidentLog[] = [
      {
        level: 'fatal',
        message: 'Error B',
        timestamp: new Date(now.getTime() + 500),
        sourceFile: 'src/b.ts',
        lineNumber: 2,
        resourceAttributes: null,
        metadata: null,
        serviceName: 'svc-b',
        fingerprint: 'fp-b',
        normalizedMessage: 'error b',
        incidentTitle: 'Error B',
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
});
