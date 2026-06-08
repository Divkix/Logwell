import { eq } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type * as schema from '../../../src/lib/server/db/schema';
import { project } from '../../../src/lib/server/db/schema';
import { setupTestDatabase } from '../../../src/lib/server/db/test-db';
import { seedProject } from '../../fixtures/db';

describe('Project retention_days column', () => {
  let db: PgliteDatabase<typeof schema>;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
  });

  describe('default value', () => {
    it('should default retention_days to null (system default)', async () => {
      const createdProject = await seedProject(db);

      expect(createdProject.retentionDays).toBeNull();
    });
  });

  describe('valid values', () => {
    it('should accept null (use system default)', async () => {
      const createdProject = await seedProject(db, { retentionDays: null });

      expect(createdProject.retentionDays).toBeNull();
    });

    it('should accept 0 (never delete)', async () => {
      const createdProject = await seedProject(db, { retentionDays: 0 });

      expect(createdProject.retentionDays).toBe(0);
    });

    it('should accept positive integers within range', async () => {
      const testValues = [1, 7, 14, 30, 60, 90, 365, 3650];

      for (const days of testValues) {
        const createdProject = await seedProject(db, { retentionDays: days });
        expect(createdProject.retentionDays).toBe(days);
      }
    });
  });

  describe('update operations', () => {
    it('should update retention_days from null to positive value', async () => {
      const createdProject = await seedProject(db, { retentionDays: null });
      expect(createdProject.retentionDays).toBeNull();

      const [updatedProject] = await db
        .update(project)
        .set({ retentionDays: 30 })
        .where(eq(project.id, createdProject.id))
        .returning();

      expect(updatedProject!.retentionDays).toBe(30);
    });

    it('should update retention_days from positive value to null', async () => {
      const createdProject = await seedProject(db, { retentionDays: 30 });
      expect(createdProject.retentionDays).toBe(30);

      const [updatedProject] = await db
        .update(project)
        .set({ retentionDays: null })
        .where(eq(project.id, createdProject.id))
        .returning();

      expect(updatedProject!.retentionDays).toBeNull();
    });

    it('should update retention_days from positive value to 0 (never delete)', async () => {
      const createdProject = await seedProject(db, { retentionDays: 30 });
      expect(createdProject.retentionDays).toBe(30);

      const [updatedProject] = await db
        .update(project)
        .set({ retentionDays: 0 })
        .where(eq(project.id, createdProject.id))
        .returning();

      expect(updatedProject!.retentionDays).toBe(0);
    });
  });

  describe('query operations', () => {
    it('should correctly retrieve retention_days in select queries', async () => {
      const createdProject = await seedProject(db, { retentionDays: 90 });

      const [foundProject] = await db
        .select()
        .from(project)
        .where(eq(project.id, createdProject.id));

      expect(foundProject!.retentionDays).toBe(90);
    });

    it('should filter projects by retention_days', async () => {
      await seedProject(db, { retentionDays: null });
      await seedProject(db, { retentionDays: 0 });
      await seedProject(db, { retentionDays: 30 });
      await seedProject(db, { retentionDays: 30 });
      await seedProject(db, { retentionDays: 90 });

      // Find projects with 30 day retention
      const projects30 = await db.select().from(project).where(eq(project.retentionDays, 30));

      expect(projects30).toHaveLength(2);
    });
  });
});
