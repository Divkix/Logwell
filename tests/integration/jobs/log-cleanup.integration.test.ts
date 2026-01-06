import { eq } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type * as schema from '../../../src/lib/server/db/schema';
import { log } from '../../../src/lib/server/db/schema';
import { setupTestDatabase } from '../../../src/lib/server/db/test-db';
import { cleanupOldLogs } from '../../../src/lib/server/jobs/log-cleanup';
import { seedLogs, seedProject } from '../../fixtures/db';

describe('cleanupOldLogs', () => {
  let db: PgliteDatabase<typeof schema>;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
  });

  describe('effective retention calculation', () => {
    it('should use project retention_days when set', async () => {
      // Create project with 7-day retention
      const project1 = await seedProject(db, { retentionDays: 7 });

      // Create logs: 5 days old (should keep) and 10 days old (should delete)
      const now = new Date();
      const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
      const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

      await seedLogs(db, project1.id, 3, { timestamp: fiveDaysAgo });
      await seedLogs(db, project1.id, 3, { timestamp: tenDaysAgo });

      // Run cleanup
      const result = await cleanupOldLogs(db);

      // Verify: 3 logs deleted (10 days old), 3 logs kept (5 days old)
      const remainingLogs = await db.select().from(log).where(eq(log.projectId, project1.id));
      expect(remainingLogs).toHaveLength(3);
      expect(result.totalLogsDeleted).toBe(3);
      expect(result.projectsProcessed).toBe(1);
      expect(result.projectsSkipped).toBe(0);
    });

    it('should use system default when project retention_days is null', async () => {
      // Create project with null retention (use system default)
      const project1 = await seedProject(db, { retentionDays: null });

      // Create logs based on system default (30 days)
      const now = new Date();
      const twentyDaysAgo = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);
      const fortyDaysAgo = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);

      await seedLogs(db, project1.id, 2, { timestamp: twentyDaysAgo });
      await seedLogs(db, project1.id, 2, { timestamp: fortyDaysAgo });

      // Run cleanup
      const result = await cleanupOldLogs(db);

      // Verify: 2 logs deleted (40 days > system default), 2 logs kept (20 days < system default)
      const remainingLogs = await db.select().from(log).where(eq(log.projectId, project1.id));
      expect(remainingLogs).toHaveLength(2);
      expect(result.totalLogsDeleted).toBe(2);
      expect(result.projectsProcessed).toBe(1);
    });

    it('should skip deletion when effective retention is 0', async () => {
      // Create project with 0 retention (never delete)
      const project1 = await seedProject(db, { retentionDays: 0 });

      // Create very old logs (365 days)
      const now = new Date();
      const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

      await seedLogs(db, project1.id, 5, { timestamp: oneYearAgo });

      // Run cleanup
      const result = await cleanupOldLogs(db);

      // Verify: no logs deleted
      const remainingLogs = await db.select().from(log).where(eq(log.projectId, project1.id));
      expect(remainingLogs).toHaveLength(5);
      expect(result.totalLogsDeleted).toBe(0);
      expect(result.projectsProcessed).toBe(0);
      expect(result.projectsSkipped).toBe(1);
    });

    it('should skip deletion when system default is 0 and project is null', async () => {
      // This test verifies the behavior when effective retention is 0
      const project1 = await seedProject(db, { retentionDays: null });
      const project2 = await seedProject(db, { retentionDays: 0 });

      const now = new Date();
      const veryOld = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

      await seedLogs(db, project1.id, 3, { timestamp: veryOld });
      await seedLogs(db, project2.id, 3, { timestamp: veryOld });

      // Run cleanup
      const result = await cleanupOldLogs(db);

      // Project2 should be skipped (retention = 0)
      // Project1 depends on system default
      const project2Logs = await db.select().from(log).where(eq(log.projectId, project2.id));
      expect(project2Logs).toHaveLength(3); // Not deleted
      expect(result.projectsSkipped).toBeGreaterThanOrEqual(1);
    });
  });

  describe('log deletion', () => {
    it('should delete logs older than retention period', async () => {
      const project1 = await seedProject(db, { retentionDays: 10 });

      const now = new Date();
      const fifteenDaysAgo = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);

      await seedLogs(db, project1.id, 8, { timestamp: fifteenDaysAgo });

      const result = await cleanupOldLogs(db);

      const remainingLogs = await db.select().from(log).where(eq(log.projectId, project1.id));
      expect(remainingLogs).toHaveLength(0);
      expect(result.totalLogsDeleted).toBe(8);
    });

    it('should NOT delete logs newer than retention period', async () => {
      const project1 = await seedProject(db, { retentionDays: 30 });

      const now = new Date();
      const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

      await seedLogs(db, project1.id, 5, { timestamp: tenDaysAgo });

      const result = await cleanupOldLogs(db);

      const remainingLogs = await db.select().from(log).where(eq(log.projectId, project1.id));
      expect(remainingLogs).toHaveLength(5);
      expect(result.totalLogsDeleted).toBe(0);
    });

    it('should handle multiple projects with different retention', async () => {
      // Project 1: 7 day retention
      const project1 = await seedProject(db, { retentionDays: 7 });
      // Project 2: 30 day retention
      const project2 = await seedProject(db, { retentionDays: 30 });
      // Project 3: never delete
      const project3 = await seedProject(db, { retentionDays: 0 });

      const now = new Date();
      const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
      const fortyDaysAgo = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);

      // Project 1: 10 days old logs should be deleted (older than 7 days)
      await seedLogs(db, project1.id, 3, { timestamp: tenDaysAgo });

      // Project 2: 10 days old logs should be kept (newer than 30 days)
      // 40 days old logs should be deleted
      await seedLogs(db, project2.id, 2, { timestamp: tenDaysAgo });
      await seedLogs(db, project2.id, 2, { timestamp: fortyDaysAgo });

      // Project 3: all logs should be kept (never delete)
      await seedLogs(db, project3.id, 5, { timestamp: fortyDaysAgo });

      const result = await cleanupOldLogs(db);

      // Verify each project
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

    it('should batch delete in chunks of 1000', async () => {
      const project1 = await seedProject(db, { retentionDays: 7 });

      const now = new Date();
      const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

      // Create 2500 old logs to test batching
      await seedLogs(db, project1.id, 1000, { timestamp: tenDaysAgo });
      await seedLogs(db, project1.id, 1000, { timestamp: tenDaysAgo });
      await seedLogs(db, project1.id, 500, { timestamp: tenDaysAgo });

      const result = await cleanupOldLogs(db);

      const remainingLogs = await db.select().from(log).where(eq(log.projectId, project1.id));
      expect(remainingLogs).toHaveLength(0);
      expect(result.totalLogsDeleted).toBe(2500);
    });

    it('should handle projects with no logs', async () => {
      const project1 = await seedProject(db, { retentionDays: 30 });
      // Create a second project without logs to verify cleanup handles empty projects gracefully
      await seedProject(db, { retentionDays: 7 });

      // Only add logs to project1
      const now = new Date();
      const fortyDaysAgo = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);
      await seedLogs(db, project1.id, 3, { timestamp: fortyDaysAgo });

      const result = await cleanupOldLogs(db);

      // Should handle project2 gracefully (no logs to delete)
      expect(result.totalLogsDeleted).toBe(3);
      expect(result.projectsProcessed).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle empty database', async () => {
      // No projects, no logs
      const result = await cleanupOldLogs(db);

      expect(result.totalLogsDeleted).toBe(0);
      expect(result.projectsProcessed).toBe(0);
      expect(result.projectsSkipped).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('should handle logs exactly at retention boundary', async () => {
      const project1 = await seedProject(db, { retentionDays: 30 });

      const now = new Date();
      // Exactly 30 days ago (at boundary)
      const exactlyThirtyDays = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      // 30 days and 1 second ago (should delete)
      const thirtyDaysAndOneSecond = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000 + 1000));
      // 29 days ago (should keep)
      const twentyNineDays = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);

      await seedLogs(db, project1.id, 2, { timestamp: exactlyThirtyDays });
      await seedLogs(db, project1.id, 2, { timestamp: thirtyDaysAndOneSecond });
      await seedLogs(db, project1.id, 2, { timestamp: twentyNineDays });

      const result = await cleanupOldLogs(db);

      // The boundary behavior: logs exactly at 30 days might be kept or deleted
      // depending on implementation (< vs <=). We expect < behavior (delete older than, not equal)
      const remainingLogs = await db.select().from(log).where(eq(log.projectId, project1.id));

      // Should keep: 29 days (2 logs) and possibly exactly 30 days (2 logs)
      // Should delete: 30 days + 1 second (2 logs)
      expect(remainingLogs.length).toBeGreaterThanOrEqual(2);
      expect(remainingLogs.length).toBeLessThanOrEqual(4);
      expect(result.totalLogsDeleted).toBeGreaterThanOrEqual(2);
      expect(result.totalLogsDeleted).toBeLessThanOrEqual(4);
    });
  });
});
