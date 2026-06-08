import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type * as schema from '../../../src/lib/server/db/schema';
import { setupTestDatabase } from '../../../src/lib/server/db/test-db';
import { searchLogs } from '../../../src/lib/server/utils/search';
import { seedLog, seedProject } from '../../fixtures/db';

describe('searchLogs Integration', () => {
  let db: PgliteDatabase<typeof schema>;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
  });

  it('returns matching logs ordered by rank and timestamp', async () => {
    const project1 = await seedProject(db);

    // Create logs with different content
    await seedLog(db, project1.id, {
      message: 'Database connection failed',
      level: 'error',
    });

    await seedLog(db, project1.id, {
      message: 'User login successful',
      level: 'info',
    });

    await seedLog(db, project1.id, {
      message: 'Database query executed',
      level: 'debug',
    });

    await seedLog(db, project1.id, {
      message: 'Connection timeout error',
      level: 'warn',
    });

    await seedLog(db, project1.id, {
      message: 'Lost database connection',
      level: 'error',
    });

    // Search for "database connection" - should match logs with BOTH terms
    const results = await searchLogs(project1.id, 'database connection', db);

    expect(results).toHaveLength(2);
    // All results should contain both "database" and "connection"
    for (const result of results) {
      expect(result.message.toLowerCase()).toContain('database');
      expect(result.message.toLowerCase()).toContain('connection');
    }
  });

  it('filters by project ID', async () => {
    const project1 = await seedProject(db);
    const project2 = await seedProject(db);

    await seedLog(db, project1.id, {
      message: 'Database error in project 1',
      level: 'error',
    });

    await seedLog(db, project2.id, {
      message: 'Database error in project 2',
      level: 'error',
    });

    const results = await searchLogs(project1.id, 'database error', db);

    expect(results).toHaveLength(1);
    expect(results[0]!.projectId).toBe(project1.id);
    expect(results[0]!.message).toBe('Database error in project 1');
  });

  it('respects limit option with default 100', async () => {
    const project1 = await seedProject(db);

    // Create 150 logs with same message
    const promises = [];
    for (let i = 0; i < 150; i++) {
      promises.push(
        seedLog(db, project1.id, {
          message: `Error message number ${i}`,
          level: 'error',
        }),
      );
    }
    await Promise.all(promises);

    const results = await searchLogs(project1.id, 'error message', db);

    expect(results.length).toBeLessThanOrEqual(100);
  });

  it('respects custom limit option', async () => {
    const project1 = await seedProject(db);

    // Create 50 logs
    const promises = [];
    for (let i = 0; i < 50; i++) {
      promises.push(
        seedLog(db, project1.id, {
          message: `Error message number ${i}`,
          level: 'error',
        }),
      );
    }
    await Promise.all(promises);

    const results = await searchLogs(project1.id, 'error message', db, { limit: 10 });

    expect(results).toHaveLength(10);
  });

  it('returns empty array when no matches found', async () => {
    const project1 = await seedProject(db);

    await seedLog(db, project1.id, {
      message: 'User login successful',
      level: 'info',
    });

    const results = await searchLogs(project1.id, 'database error', db);

    expect(results).toEqual([]);
  });

  it('searches in metadata field with lower rank', async () => {
    const project1 = await seedProject(db);

    await seedLog(db, project1.id, {
      message: 'User action',
      metadata: { error: 'Database connection timeout', user: 'john' },
      level: 'error',
    });

    await seedLog(db, project1.id, {
      message: 'Database connection failed',
      level: 'error',
    });

    const results = await searchLogs(project1.id, 'database connection', db);

    expect(results).toHaveLength(2);
    // Log with "database connection" in message should rank higher
    expect(results[0]!.message).toBe('Database connection failed');
  });

  it('handles special characters in search terms', async () => {
    const project1 = await seedProject(db);

    await seedLog(db, project1.id, {
      message: 'Error: database connection failed!',
      level: 'error',
    });

    // Should escape special characters and still find the match
    const results = await searchLogs(project1.id, 'database connection failed!', db);

    expect(results).toHaveLength(1);
    expect(results[0]!.message).toBe('Error: database connection failed!');
  });

  it('performs case-insensitive search', async () => {
    const project1 = await seedProject(db);

    await seedLog(db, project1.id, {
      message: 'DATABASE CONNECTION FAILED',
      level: 'error',
    });

    await seedLog(db, project1.id, {
      message: 'database connection failed',
      level: 'error',
    });

    const results = await searchLogs(project1.id, 'DaTaBaSe CoNnEcTiOn', db);

    expect(results).toHaveLength(2);
  });

  it('handles search with single term', async () => {
    const project1 = await seedProject(db);

    await seedLog(db, project1.id, {
      message: 'Error occurred',
      level: 'error',
    });

    await seedLog(db, project1.id, {
      message: 'Warning generated',
      level: 'warn',
    });

    const results = await searchLogs(project1.id, 'error', db);

    expect(results).toHaveLength(1);
    expect(results[0]!.message).toBe('Error occurred');
  });

  it('returns empty array for empty search term', async () => {
    const project1 = await seedProject(db);

    await seedLog(db, project1.id, {
      message: 'Some log message',
      level: 'info',
    });

    const results = await searchLogs(project1.id, '', db);

    expect(results).toEqual([]);
  });

  it('orders by timestamp DESC when ranks are equal', async () => {
    const project1 = await seedProject(db);

    // Create logs with same content but different timestamps
    const log1 = await seedLog(db, project1.id, {
      message: 'Database error',
      level: 'error',
    });

    // Wait a bit to ensure different timestamp
    await new Promise((resolve) => setTimeout(resolve, 10));

    const log2 = await seedLog(db, project1.id, {
      message: 'Database error',
      level: 'error',
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const log3 = await seedLog(db, project1.id, {
      message: 'Database error',
      level: 'error',
    });

    const results = await searchLogs(project1.id, 'database error', db);

    expect(results).toHaveLength(3);
    // Should be ordered by timestamp DESC (newest first)
    expect(results[0]!.id).toBe(log3.id);
    expect(results[1]!.id).toBe(log2.id);
    expect(results[2]!.id).toBe(log1.id);
  });
});
