import { eq } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as schema from '../../../../../src/lib/server/db/schema';
import { type Log, log } from '../../../../../src/lib/server/db/schema';
import { setupTestDatabase } from '../../../../../src/lib/server/db/test-db';
import { logEventBus } from '../../../../../src/lib/server/events';
import { clearApiKeyCache } from '../../../../../src/lib/server/utils/api-key';
import { POST } from '../../../../../src/routes/api/v1/logs/batch/+server';
import { seedProject } from '../../../../fixtures/db';

/**
 * Helper to create a mock SvelteKit RequestEvent
 */
function createRequestEvent(request: Request, db: PgliteDatabase<typeof schema>) {
  return {
    request,
    locals: { db },
    params: {},
    url: new URL(request.url),
    platform: undefined,
    route: { id: '/api/v1/logs/batch' },
    isDataRequest: false,
    isSubRequest: false,
    isRemoteRequest: false,
    tracing: null,
    cookies: {
      get: () => undefined,
      getAll: () => [],
      set: () => {},
      delete: () => {},
      serialize: () => '',
    },
    fetch: globalThis.fetch,
    getClientAddress: () => '127.0.0.1',
    setHeaders: () => {},
  } as unknown;
}

describe('POST /api/v1/logs/batch', () => {
  let db: PgliteDatabase<typeof schema>;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
    clearApiKeyCache();
    logEventBus.clear();
  });

  afterEach(async () => {
    logEventBus.clear();
    await cleanup();
  });

  it('returns 400 if batch exceeds 100 logs', async () => {
    const project = await seedProject(db);

    // Create 101 logs - exceeds max batch size
    const logs = Array.from({ length: 101 }, (_, i) => ({
      level: 'info',
      message: `Test message ${i}`,
    }));

    const request = new Request('http://localhost/api/v1/logs/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${project.apiKey}`,
      },
      body: JSON.stringify({ logs }),
    });

    const event = createRequestEvent(request, db);
    const response = await POST(event as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toBe('validation_error');
    expect(body.message).toContain('100');
  });

  it('returns 400 if any log in batch is invalid', async () => {
    const project = await seedProject(db);

    const logs = [
      { level: 'info', message: 'Valid log 1' },
      { level: 'invalid_level', message: 'Invalid log' }, // Invalid level
      { level: 'error', message: 'Valid log 2' },
    ];

    const request = new Request('http://localhost/api/v1/logs/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${project.apiKey}`,
      },
      body: JSON.stringify({ logs }),
    });

    const event = createRequestEvent(request, db);
    const response = await POST(event as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toBe('validation_error');
  });

  it('returns 201 with all inserted log ids', async () => {
    const project = await seedProject(db);

    const logs = [
      { level: 'info', message: 'Log 1' },
      { level: 'warn', message: 'Log 2' },
      { level: 'error', message: 'Log 3' },
    ];

    const request = new Request('http://localhost/api/v1/logs/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${project.apiKey}`,
      },
      body: JSON.stringify({ logs }),
    });

    const event = createRequestEvent(request, db);
    const response = await POST(event as never);

    expect(response.status).toBe(201);
    const body = await response.json();

    expect(body).toHaveProperty('inserted');
    expect(body.inserted).toBe(3);
    expect(body).toHaveProperty('logs');
    expect(body.logs).toHaveLength(3);

    // Each log should have id and timestamp
    for (const logEntry of body.logs) {
      expect(logEntry).toHaveProperty('id');
      expect(logEntry).toHaveProperty('timestamp');
      expect(typeof logEntry.id).toBe('string');
      expect(logEntry.id.length).toBeGreaterThan(0);
    }
  });

  it('inserts all logs in single transaction', async () => {
    const project = await seedProject(db);

    const logs = [
      { level: 'debug', message: 'Debug log' },
      { level: 'info', message: 'Info log' },
      { level: 'warn', message: 'Warn log' },
      { level: 'error', message: 'Error log' },
      { level: 'fatal', message: 'Fatal log' },
    ];

    const request = new Request('http://localhost/api/v1/logs/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${project.apiKey}`,
      },
      body: JSON.stringify({ logs }),
    });

    const event = createRequestEvent(request, db);
    const response = await POST(event as never);

    expect(response.status).toBe(201);

    // Verify all logs were stored in database
    const storedLogs = await db.select().from(log).where(eq(log.projectId, project.id));

    expect(storedLogs).toHaveLength(5);

    // Verify all levels are present
    const levels = storedLogs.map((l) => l.level);
    expect(levels).toContain('debug');
    expect(levels).toContain('info');
    expect(levels).toContain('warn');
    expect(levels).toContain('error');
    expect(levels).toContain('fatal');
  });

  describe('Event Bus Integration', () => {
    it('emits all logs to event bus after successful batch ingestion', async () => {
      const project = await seedProject(db);

      // Subscribe to event bus and capture emitted logs
      const emittedLogs: Log[] = [];
      const listener = vi.fn((log: Log) => {
        emittedLogs.push(log);
      });
      const unsubscribe = logEventBus.onLog(project.id, listener);

      const logs = [
        { level: 'info', message: 'Batch log 1' },
        { level: 'warn', message: 'Batch log 2' },
        { level: 'error', message: 'Batch log 3' },
      ];

      const request = new Request('http://localhost/api/v1/logs/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${project.apiKey}`,
        },
        body: JSON.stringify({ logs }),
      });

      const event = createRequestEvent(request, db);
      const response = await POST(event as never);

      expect(response.status).toBe(201);
      const body = await response.json();

      // Verify listener was called for each log
      expect(listener).toHaveBeenCalledTimes(3);
      expect(emittedLogs).toHaveLength(3);

      // Verify emitted log IDs match returned IDs
      const returnedIds = body.logs.map((l: { id: string }) => l.id);
      const emittedIds = emittedLogs.map((l) => l.id);
      expect(emittedIds.sort()).toEqual(returnedIds.sort());

      // Verify all logs have correct project
      expect(emittedLogs.every((l) => l.projectId === project.id)).toBe(true);

      // Verify messages are present
      const emittedMessages = emittedLogs.map((l) => l.message);
      expect(emittedMessages).toContain('Batch log 1');
      expect(emittedMessages).toContain('Batch log 2');
      expect(emittedMessages).toContain('Batch log 3');

      unsubscribe();
    });

    it('does not emit to event bus on validation error in batch', async () => {
      const project = await seedProject(db);

      const listener = vi.fn();
      const unsubscribe = logEventBus.onLog(project.id, listener);

      const logs = [
        { level: 'info', message: 'Valid log' },
        { level: 'invalid_level', message: 'Invalid log' }, // Invalid
      ];

      const request = new Request('http://localhost/api/v1/logs/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${project.apiKey}`,
        },
        body: JSON.stringify({ logs }),
      });

      const event = createRequestEvent(request, db);
      const response = await POST(event as never);

      expect(response.status).toBe(400);
      expect(listener).not.toHaveBeenCalled();

      unsubscribe();
    });

    it('emits logs in insertion order', async () => {
      const project = await seedProject(db);

      const emittedLogs: Log[] = [];
      const listener = vi.fn((log: Log) => {
        emittedLogs.push(log);
      });
      const unsubscribe = logEventBus.onLog(project.id, listener);

      const logs = [
        { level: 'debug', message: 'First log' },
        { level: 'info', message: 'Second log' },
        { level: 'warn', message: 'Third log' },
        { level: 'error', message: 'Fourth log' },
        { level: 'fatal', message: 'Fifth log' },
      ];

      const request = new Request('http://localhost/api/v1/logs/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${project.apiKey}`,
        },
        body: JSON.stringify({ logs }),
      });

      const event = createRequestEvent(request, db);
      const response = await POST(event as never);

      expect(response.status).toBe(201);
      expect(emittedLogs).toHaveLength(5);

      // Verify order matches input order
      expect(emittedLogs[0].message).toBe('First log');
      expect(emittedLogs[1].message).toBe('Second log');
      expect(emittedLogs[2].message).toBe('Third log');
      expect(emittedLogs[3].message).toBe('Fourth log');
      expect(emittedLogs[4].message).toBe('Fifth log');

      unsubscribe();
    });
  });
});
