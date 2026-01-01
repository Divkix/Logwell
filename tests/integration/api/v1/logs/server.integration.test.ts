import { eq } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type * as schema from '../../../../../src/lib/server/db/schema';
import { log } from '../../../../../src/lib/server/db/schema';
import { setupTestDatabase } from '../../../../../src/lib/server/db/test-db';
import { clearApiKeyCache } from '../../../../../src/lib/server/utils/api-key';
import { POST } from '../../../../../src/routes/api/v1/logs/+server';
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
    route: { id: '/api/v1/logs' },
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

describe('POST /api/v1/logs', () => {
  let db: PgliteDatabase<typeof schema>;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
    clearApiKeyCache();
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('Authentication', () => {
    it('returns 401 without Authorization header', async () => {
      const request = new Request('http://localhost/api/v1/logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          level: 'info',
          message: 'Test message',
        }),
      });

      const event = createRequestEvent(request, db);
      const response = await POST(event as never);

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body).toHaveProperty('error');
      expect(body.error).toBe('unauthorized');
    });

    it('returns 401 with invalid API key', async () => {
      const request = new Request('http://localhost/api/v1/logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer svl_invalid_key_that_does_not_exist_xx',
        },
        body: JSON.stringify({
          level: 'info',
          message: 'Test message',
        }),
      });

      const event = createRequestEvent(request, db);
      const response = await POST(event as never);

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body).toHaveProperty('error');
      expect(body.error).toBe('unauthorized');
    });

    it('returns 401 with malformed API key format', async () => {
      const request = new Request('http://localhost/api/v1/logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer not_valid_format',
        },
        body: JSON.stringify({
          level: 'info',
          message: 'Test message',
        }),
      });

      const event = createRequestEvent(request, db);
      const response = await POST(event as never);

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body).toHaveProperty('error');
    });
  });

  describe('Validation', () => {
    it('returns 400 for invalid log level', async () => {
      const project = await seedProject(db);

      const request = new Request('http://localhost/api/v1/logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${project.apiKey}`,
        },
        body: JSON.stringify({
          level: 'invalid_level',
          message: 'Test message',
        }),
      });

      const event = createRequestEvent(request, db);
      const response = await POST(event as never);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toHaveProperty('error');
      expect(body.error).toBe('validation_error');
      expect(body.message).toContain('level');
    });

    it('returns 400 for missing message', async () => {
      const project = await seedProject(db);

      const request = new Request('http://localhost/api/v1/logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${project.apiKey}`,
        },
        body: JSON.stringify({
          level: 'info',
        }),
      });

      const event = createRequestEvent(request, db);
      const response = await POST(event as never);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toHaveProperty('error');
      expect(body.error).toBe('validation_error');
      expect(body.message).toContain('message');
    });

    it('returns 400 for empty message', async () => {
      const project = await seedProject(db);

      const request = new Request('http://localhost/api/v1/logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${project.apiKey}`,
        },
        body: JSON.stringify({
          level: 'info',
          message: '',
        }),
      });

      const event = createRequestEvent(request, db);
      const response = await POST(event as never);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toHaveProperty('error');
      expect(body.error).toBe('validation_error');
    });

    it('returns 400 for invalid JSON body', async () => {
      const project = await seedProject(db);

      const request = new Request('http://localhost/api/v1/logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${project.apiKey}`,
        },
        body: 'not valid json',
      });

      const event = createRequestEvent(request, db);
      const response = await POST(event as never);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toHaveProperty('error');
    });

    it('returns 400 for negative line_number', async () => {
      const project = await seedProject(db);

      const request = new Request('http://localhost/api/v1/logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${project.apiKey}`,
        },
        body: JSON.stringify({
          level: 'info',
          message: 'Test message',
          line_number: -5,
        }),
      });

      const event = createRequestEvent(request, db);
      const response = await POST(event as never);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toHaveProperty('error');
      expect(body.error).toBe('validation_error');
    });
  });

  describe('Successful Log Ingestion', () => {
    it('returns 201 with log id and timestamp', async () => {
      const project = await seedProject(db);

      const request = new Request('http://localhost/api/v1/logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${project.apiKey}`,
        },
        body: JSON.stringify({
          level: 'info',
          message: 'Test log message',
        }),
      });

      const event = createRequestEvent(request, db);
      const response = await POST(event as never);

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body).toHaveProperty('id');
      expect(body).toHaveProperty('timestamp');
      expect(typeof body.id).toBe('string');
      expect(body.id.length).toBeGreaterThan(0);
    });

    it('auto-assigns timestamp if not provided', async () => {
      const project = await seedProject(db);
      const beforeRequest = new Date();

      const request = new Request('http://localhost/api/v1/logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${project.apiKey}`,
        },
        body: JSON.stringify({
          level: 'info',
          message: 'Test log without timestamp',
        }),
      });

      const event = createRequestEvent(request, db);
      const response = await POST(event as never);
      const afterRequest = new Date();

      expect(response.status).toBe(201);
      const body = await response.json();

      const timestamp = new Date(body.timestamp);
      expect(timestamp.getTime()).toBeGreaterThanOrEqual(beforeRequest.getTime());
      expect(timestamp.getTime()).toBeLessThanOrEqual(afterRequest.getTime());
    });

    it('uses provided timestamp when specified', async () => {
      const project = await seedProject(db);
      const providedTimestamp = '2024-01-15T14:32:05.123Z';

      const request = new Request('http://localhost/api/v1/logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${project.apiKey}`,
        },
        body: JSON.stringify({
          level: 'info',
          message: 'Test log with timestamp',
          timestamp: providedTimestamp,
        }),
      });

      const event = createRequestEvent(request, db);
      const response = await POST(event as never);

      expect(response.status).toBe(201);
      const body = await response.json();

      expect(new Date(body.timestamp).toISOString()).toBe(providedTimestamp);
    });

    it('stores all optional fields correctly', async () => {
      const project = await seedProject(db);
      const logData = {
        level: 'error',
        message: 'Database connection failed',
        metadata: {
          database: 'users_db',
          error_code: 'ECONNREFUSED',
        },
        source_file: 'src/db/connection.ts',
        line_number: 45,
        request_id: 'req_abc123',
        user_id: 'user_456',
        ip_address: '192.168.1.100',
      };

      const request = new Request('http://localhost/api/v1/logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${project.apiKey}`,
        },
        body: JSON.stringify(logData),
      });

      const event = createRequestEvent(request, db);
      const response = await POST(event as never);

      expect(response.status).toBe(201);
      const body = await response.json();

      // Verify the log was stored in the database with all fields
      const [storedLog] = await db.select().from(log).where(eq(log.id, body.id));

      expect(storedLog).toBeDefined();
      expect(storedLog.projectId).toBe(project.id);
      expect(storedLog.level).toBe('error');
      expect(storedLog.message).toBe('Database connection failed');
      expect(storedLog.metadata).toEqual({
        database: 'users_db',
        error_code: 'ECONNREFUSED',
      });
      expect(storedLog.sourceFile).toBe('src/db/connection.ts');
      expect(storedLog.lineNumber).toBe(45);
      expect(storedLog.requestId).toBe('req_abc123');
      expect(storedLog.userId).toBe('user_456');
      expect(storedLog.ipAddress).toBe('192.168.1.100');
    });

    it('stores log with null optional fields', async () => {
      const project = await seedProject(db);

      const request = new Request('http://localhost/api/v1/logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${project.apiKey}`,
        },
        body: JSON.stringify({
          level: 'debug',
          message: 'Minimal log entry',
        }),
      });

      const event = createRequestEvent(request, db);
      const response = await POST(event as never);

      expect(response.status).toBe(201);
      const body = await response.json();

      // Verify optional fields are null
      const [storedLog] = await db.select().from(log).where(eq(log.id, body.id));

      expect(storedLog).toBeDefined();
      expect(storedLog.metadata).toBeNull();
      expect(storedLog.sourceFile).toBeNull();
      expect(storedLog.lineNumber).toBeNull();
      expect(storedLog.requestId).toBeNull();
      expect(storedLog.userId).toBeNull();
      expect(storedLog.ipAddress).toBeNull();
    });

    it('accepts all valid log levels', async () => {
      const project = await seedProject(db);
      const levels = ['debug', 'info', 'warn', 'error', 'fatal'] as const;

      for (const level of levels) {
        const request = new Request('http://localhost/api/v1/logs', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${project.apiKey}`,
          },
          body: JSON.stringify({
            level,
            message: `Test ${level} message`,
          }),
        });

        const event = createRequestEvent(request, db);
        const response = await POST(event as never);

        expect(response.status).toBe(201);
        const body = await response.json();

        // Verify level was stored correctly
        const [storedLog] = await db.select().from(log).where(eq(log.id, body.id));

        expect(storedLog.level).toBe(level);
      }
    });

    it('associates log with correct project', async () => {
      // Create two projects
      const project1 = await seedProject(db);
      const project2 = await seedProject(db);

      // Send log to project1
      const request = new Request('http://localhost/api/v1/logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${project1.apiKey}`,
        },
        body: JSON.stringify({
          level: 'info',
          message: 'Project 1 log',
        }),
      });

      const event = createRequestEvent(request, db);
      const response = await POST(event as never);

      expect(response.status).toBe(201);
      const body = await response.json();

      // Verify log is associated with project1, not project2
      const [storedLog] = await db.select().from(log).where(eq(log.id, body.id));

      expect(storedLog.projectId).toBe(project1.id);
      expect(storedLog.projectId).not.toBe(project2.id);
    });
  });
});
