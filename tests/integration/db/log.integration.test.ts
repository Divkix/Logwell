import { eq } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { nanoid } from 'nanoid';
import { beforeEach, describe, expect, it } from 'vitest';
import type * as schema from '../../../src/lib/server/db/schema';
import { log, project } from '../../../src/lib/server/db/schema';
import { setupTestDatabase } from '../../../src/lib/server/db/test-db';
import { createLogFactory, seedProject } from '../../fixtures/db';

describe('Log Table Schema', () => {
  let db: PgliteDatabase<typeof schema>;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
  });

  it('should insert log entry with all fields', async () => {
    // Create project first
    const testProject = await seedProject(db);

    const logId = nanoid();
    const logData = {
      id: logId,
      projectId: testProject.id,
      level: 'error' as const,
      message: 'Test error message',
      metadata: { userId: '123', action: 'login' },
      sourceFile: 'auth.service.ts',
      lineNumber: 42,
      requestId: 'req_123',
      userId: 'user_456',
      ipAddress: '192.168.1.1',
    };

    const [createdLog] = await db.insert(log).values(logData).returning();

    expect(createdLog).toBeDefined();
    expect(createdLog.id).toBe(logId);
    expect(createdLog.projectId).toBe(testProject.id);
    expect(createdLog.level).toBe('error');
    expect(createdLog.message).toBe('Test error message');
    expect(createdLog.metadata).toEqual({ userId: '123', action: 'login' });
    expect(createdLog.sourceFile).toBe('auth.service.ts');
    expect(createdLog.lineNumber).toBe(42);
    expect(createdLog.requestId).toBe('req_123');
    expect(createdLog.userId).toBe('user_456');
    expect(createdLog.ipAddress).toBe('192.168.1.1');
    expect(createdLog.timestamp).toBeInstanceOf(Date);
  });

  it('should cascade delete logs when project deleted', async () => {
    // Create project
    const testProject = await seedProject(db);

    // Create multiple logs for the project
    const log1 = createLogFactory({ projectId: testProject.id });
    const log2 = createLogFactory({ projectId: testProject.id });
    const log3 = createLogFactory({ projectId: testProject.id });

    await db.insert(log).values([log1, log2, log3]);

    // Verify logs exist
    const logsBefore = await db.select().from(log).where(eq(log.projectId, testProject.id));
    expect(logsBefore).toHaveLength(3);

    // Delete the project
    await db.delete(project).where(eq(project.id, testProject.id));

    // Verify all logs are deleted
    const logsAfter = await db.select().from(log).where(eq(log.projectId, testProject.id));
    expect(logsAfter).toHaveLength(0);
  });

  it('should search logs by message content', async () => {
    // Create project
    const testProject = await seedProject(db);

    // Create logs with different messages
    const logs = [
      createLogFactory({
        projectId: testProject.id,
        message: 'User authentication failed',
      }),
      createLogFactory({
        projectId: testProject.id,
        message: 'Database connection successful',
      }),
      createLogFactory({
        projectId: testProject.id,
        message: 'User authentication successful',
      }),
      createLogFactory({
        projectId: testProject.id,
        message: 'Invalid API key provided',
      }),
    ];

    await db.insert(log).values(logs);

    // Search for logs containing "authentication"
    // Using to_tsquery for full-text search
    const searchResults = await db.execute<{ id: string; message: string }>(
      `SELECT id, message FROM log
       WHERE search @@ to_tsquery('english', 'authentication')
       ORDER BY message`,
    );

    expect(searchResults.rows).toHaveLength(2);
    expect(searchResults.rows[0].message).toBe('User authentication failed');
    expect(searchResults.rows[1].message).toBe('User authentication successful');
  });

  it('should search logs by metadata content', async () => {
    // Create project
    const testProject = await seedProject(db);

    // Create logs with different metadata
    const logs = [
      createLogFactory({
        projectId: testProject.id,
        message: 'User event',
        metadata: { action: 'login', email: 'user@example.com' },
      }),
      createLogFactory({
        projectId: testProject.id,
        message: 'User event',
        metadata: { action: 'logout', email: 'admin@example.com' },
      }),
      createLogFactory({
        projectId: testProject.id,
        message: 'User event',
        metadata: { action: 'login', email: 'test@example.com' },
      }),
      createLogFactory({
        projectId: testProject.id,
        message: 'System event',
        metadata: { action: 'restart' },
      }),
    ];

    await db.insert(log).values(logs);

    // Search for logs with metadata containing "login"
    const searchResults = await db.execute<{ id: string; metadata: unknown }>(
      `SELECT id, metadata FROM log
       WHERE search @@ to_tsquery('english', 'login')
       ORDER BY id`,
    );

    expect(searchResults.rows.length).toBeGreaterThanOrEqual(2);
    // Verify the results contain login action
    const metadataWithLogin = searchResults.rows.filter((row) => {
      const meta = row.metadata as { action?: string };
      return meta.action === 'login';
    });
    expect(metadataWithLogin).toHaveLength(2);
  });
});
