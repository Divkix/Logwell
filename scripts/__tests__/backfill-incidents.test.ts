import { and, eq, gte } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type * as schema from '../../src/lib/server/db/schema';
import { incident, log } from '../../src/lib/server/db/schema';
import { setupTestDatabase } from '../../src/lib/server/db/test-db';
import { backfillProjectIncidents } from '../../src/lib/server/utils/incident-backfill';
import { seedLog, seedProject } from '../../tests/fixtures/db';

describe('backfill-incidents', () => {
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

  it('backfills only grouped levels within the selected window', async () => {
    const project = await seedProject(db);
    const now = Date.now();
    const since = new Date(now - 7 * 24 * 60 * 60 * 1000);

    const inWindowError = await seedLog(db, project.id, {
      level: 'error',
      message: 'Database timeout after 1000ms',
      timestamp: new Date(now - 24 * 60 * 60 * 1000),
    });
    const inWindowFatal = await seedLog(db, project.id, {
      level: 'fatal',
      message: 'Panic in worker 42',
      timestamp: new Date(now - 2 * 60 * 60 * 1000),
    });
    const inWindowInfo = await seedLog(db, project.id, {
      level: 'info',
      message: 'Regular info log',
      timestamp: new Date(now - 2 * 60 * 60 * 1000),
    });
    const outOfWindowError = await seedLog(db, project.id, {
      level: 'error',
      message: 'Old error should be skipped',
      timestamp: new Date(now - 9 * 24 * 60 * 60 * 1000),
    });

    const result = await backfillProjectIncidents(db, project.id, since);
    expect(result.processedLogs).toBe(2);

    const [logError] = await db.select().from(log).where(eq(log.id, inWindowError.id));
    const [logFatal] = await db.select().from(log).where(eq(log.id, inWindowFatal.id));
    const [logInfo] = await db.select().from(log).where(eq(log.id, inWindowInfo.id));
    const [logOld] = await db.select().from(log).where(eq(log.id, outOfWindowError.id));

    expect(logError.incidentId).toBeTruthy();
    expect(logFatal.incidentId).toBeTruthy();
    expect(logInfo.incidentId).toBeNull();
    expect(logOld.incidentId).toBeNull();

    const incidents = await db.select().from(incident).where(eq(incident.projectId, project.id));
    expect(incidents.length).toBe(2);
  });

  it('is idempotent when run multiple times', async () => {
    const project = await seedProject(db);
    const now = Date.now();
    const since = new Date(now - 7 * 24 * 60 * 60 * 1000);

    await seedLog(db, project.id, {
      level: 'error',
      message: 'Database timeout after 1000ms for user 123',
      timestamp: new Date(now - 60 * 60 * 1000),
    });
    await seedLog(db, project.id, {
      level: 'error',
      message: 'Database timeout after 2500ms for user 999',
      timestamp: new Date(now - 55 * 60 * 1000),
    });

    const first = await backfillProjectIncidents(db, project.id, since);
    const second = await backfillProjectIncidents(db, project.id, since);

    expect(first.updatedLogs).toBe(2);
    expect(second.updatedLogs).toBe(0);

    const incidents = await db
      .select()
      .from(incident)
      .where(and(eq(incident.projectId, project.id), gte(incident.lastSeen, since)));
    expect(incidents).toHaveLength(1);

    const incidentLogs = await db
      .select({ incidentId: log.incidentId })
      .from(log)
      .where(eq(log.projectId, project.id));

    expect(incidentLogs.every((entry) => entry.incidentId === incidents[0].id)).toBe(true);
  });
});
