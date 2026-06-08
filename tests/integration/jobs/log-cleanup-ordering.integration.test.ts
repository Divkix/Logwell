import { asc, eq } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type * as schema from '../../../src/lib/server/db/schema';
import { log } from '../../../src/lib/server/db/schema';
import { setupTestDatabase } from '../../../src/lib/server/db/test-db';
import { cleanupOldLogs } from '../../../src/lib/server/jobs/log-cleanup';
import { seedLog, seedProject } from '../../fixtures/db';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('cleanupOldLogs batch selection', () => {
  let db: PgliteDatabase<typeof schema>;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
  });

  it('deletes only logs older than retention, keeping the most recent', async () => {
    const project1 = await seedProject(db, { retentionDays: 7 });

    const now = new Date();
    // Seed logs across a spread of timestamps, oldest first.
    // With a 7-day retention, the three oldest (>7 days) should be deleted and
    // the three newest (<7 days) should remain.
    const ages = [12, 10, 8, 5, 3, 1]; // days ago
    for (const days of ages) {
      await seedLog(db, project1.id, {
        message: `log-${days}d`,
        timestamp: new Date(now.getTime() - days * DAY_MS),
      });
    }

    const result = await cleanupOldLogs(db);

    expect(result.errors).toEqual([]);
    expect(result.totalLogsDeleted).toBe(3);
    expect(result.projectsProcessed).toBe(1);
    expect(result.projectsSkipped).toBe(0);

    // The surviving logs must be the three most recent ones, in ascending order.
    const remaining = await db
      .select()
      .from(log)
      .where(eq(log.projectId, project1.id))
      .orderBy(asc(log.timestamp));

    expect(remaining).toHaveLength(3);
    expect(remaining.map((l) => l.message)).toEqual(['log-5d', 'log-3d', 'log-1d']);

    // Every surviving log must be newer than the 7-day cutoff.
    const cutoff = new Date(now.getTime() - 7 * DAY_MS);
    for (const l of remaining) {
      expect(l.timestamp.getTime()).toBeGreaterThanOrEqual(cutoff.getTime());
    }
  });

  it('deletes the correct logs per project when retention differs', async () => {
    const project1 = await seedProject(db, { retentionDays: 7 });
    const project2 = await seedProject(db, { retentionDays: 30 });

    const now = new Date();
    const tenDaysAgo = new Date(now.getTime() - 10 * DAY_MS);
    const fortyDaysAgo = new Date(now.getTime() - 40 * DAY_MS);

    // project1 (7d): 10-day-old log is deleted.
    await seedLog(db, project1.id, { message: 'p1-old', timestamp: tenDaysAgo });
    await seedLog(db, project1.id, { message: 'p1-fresh', timestamp: now });

    // project2 (30d): 10-day-old kept, 40-day-old deleted.
    await seedLog(db, project2.id, { message: 'p2-recent', timestamp: tenDaysAgo });
    await seedLog(db, project2.id, { message: 'p2-old', timestamp: fortyDaysAgo });

    const result = await cleanupOldLogs(db);

    expect(result.errors).toEqual([]);
    expect(result.totalLogsDeleted).toBe(2); // 1 from p1, 1 from p2
    expect(result.projectsProcessed).toBe(2);

    const p1Remaining = await db.select().from(log).where(eq(log.projectId, project1.id));
    expect(p1Remaining.map((l) => l.message)).toEqual(['p1-fresh']);

    const p2Remaining = await db.select().from(log).where(eq(log.projectId, project2.id));
    expect(p2Remaining.map((l) => l.message)).toEqual(['p2-recent']);
  });
});
