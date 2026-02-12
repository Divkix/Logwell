import { eq } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type * as schema from '../../../src/lib/server/db/schema';
import { incident, log } from '../../../src/lib/server/db/schema';
import { setupTestDatabase } from '../../../src/lib/server/db/test-db';
import { logEventBus } from '../../../src/lib/server/events';
import { clearApiKeyCache } from '../../../src/lib/server/utils/api-key';
import { POST } from '../../../src/routes/v1/ingest/+server';
import { seedProject } from '../../fixtures/db';

function createRequestEvent(request: Request, db: PgliteDatabase<typeof schema>) {
  return {
    request,
    locals: { db },
    params: {},
    url: new URL(request.url),
    platform: undefined,
    route: { id: '/v1/ingest' },
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

describe('POST /v1/ingest (Simple API)', () => {
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

  describe('Authentication', () => {
    it('returns 401 without Authorization header', async () => {
      const request = new Request('http://localhost/v1/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: 'info', message: 'test' }),
      });

      const event = createRequestEvent(request, db);
      const response = await POST(event as never);

      expect(response.status).toBe(401);
    });

    it('returns 401 with invalid API key', async () => {
      const request = new Request('http://localhost/v1/ingest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer lw_invalid_key_that_does_not_exist',
        },
        body: JSON.stringify({ level: 'info', message: 'test' }),
      });

      const event = createRequestEvent(request, db);
      const response = await POST(event as never);

      expect(response.status).toBe(401);
    });
  });

  describe('Single log ingestion', () => {
    it('ingests a single log with minimal fields', async () => {
      const project = await seedProject(db);

      const request = new Request('http://localhost/v1/ingest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${project.apiKey}`,
        },
        body: JSON.stringify({ level: 'info', message: 'Hello world' }),
      });

      const event = createRequestEvent(request, db);
      const response = await POST(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ accepted: 1 });

      const [inserted] = await db.select().from(log).where(eq(log.projectId, project.id));
      expect(inserted).toBeTruthy();
      expect(inserted.level).toBe('info');
      expect(inserted.message).toBe('Hello world');
      expect(inserted.timestamp).toBeTruthy();
    });

    it('ingests a single log with all optional fields', async () => {
      const project = await seedProject(db);
      const timestamp = '2025-01-05T12:00:00.000Z';

      const request = new Request('http://localhost/v1/ingest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${project.apiKey}`,
        },
        body: JSON.stringify({
          level: 'error',
          message: 'Database connection failed',
          timestamp,
          service: 'api-gateway',
          metadata: { userId: '123', requestId: 'req-456', error: { code: 'ECONNREFUSED' } },
        }),
      });

      const event = createRequestEvent(request, db);
      const response = await POST(event as never);

      expect(response.status).toBe(200);

      const [inserted] = await db.select().from(log).where(eq(log.projectId, project.id));
      expect(inserted.level).toBe('error');
      expect(inserted.message).toBe('Database connection failed');
      expect(inserted.timestamp?.toISOString()).toBe(timestamp);
      expect(inserted.resourceAttributes).toEqual({ 'service.name': 'api-gateway' });
      expect(inserted.metadata).toEqual({
        userId: '123',
        requestId: 'req-456',
        error: { code: 'ECONNREFUSED' },
      });
    });

    it('uses current time when timestamp is invalid', async () => {
      const project = await seedProject(db);
      const before = new Date();

      const request = new Request('http://localhost/v1/ingest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${project.apiKey}`,
        },
        body: JSON.stringify({
          level: 'debug',
          message: 'Test',
          timestamp: 'not-a-valid-timestamp',
        }),
      });

      const event = createRequestEvent(request, db);
      const response = await POST(event as never);

      expect(response.status).toBe(200);

      const [inserted] = await db.select().from(log).where(eq(log.projectId, project.id));
      const after = new Date();

      // Timestamp should be between before and after
      expect(inserted.timestamp?.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(inserted.timestamp?.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('Batch ingestion', () => {
    it('ingests multiple logs in a batch', async () => {
      const project = await seedProject(db);

      const logs = [
        { level: 'debug', message: 'Starting process' },
        { level: 'info', message: 'Process running' },
        { level: 'warn', message: 'Low memory warning' },
        { level: 'error', message: 'Process failed' },
        { level: 'fatal', message: 'System shutdown' },
      ];

      const request = new Request('http://localhost/v1/ingest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${project.apiKey}`,
        },
        body: JSON.stringify(logs),
      });

      const event = createRequestEvent(request, db);
      const response = await POST(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ accepted: 5 });

      const insertedLogs = await db.select().from(log).where(eq(log.projectId, project.id));
      expect(insertedLogs.length).toBe(5);
    });

    it('handles partial success with mixed valid/invalid logs', async () => {
      const project = await seedProject(db);

      const logs = [
        { level: 'info', message: 'Valid log 1' },
        { level: 'invalid_level', message: 'Invalid log' },
        { level: 'info', message: 'Valid log 2' },
        { level: 'error' }, // Missing message
        { level: 'warn', message: 'Valid log 3' },
      ];

      const request = new Request('http://localhost/v1/ingest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${project.apiKey}`,
        },
        body: JSON.stringify(logs),
      });

      const event = createRequestEvent(request, db);
      const response = await POST(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.accepted).toBe(3);
      expect(body.rejected).toBe(2);
      expect(body.errors).toHaveLength(2);
      expect(body.errors[0]).toContain('invalid level');
      expect(body.errors[1]).toContain('missing required field');

      const insertedLogs = await db.select().from(log).where(eq(log.projectId, project.id));
      expect(insertedLogs.length).toBe(3);
    });
  });

  describe('Validation errors', () => {
    it('returns 400 for invalid JSON', async () => {
      const project = await seedProject(db);

      const request = new Request('http://localhost/v1/ingest', {
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
      expect(body.error).toBe('invalid_json');
    });

    it('returns 400 for empty array', async () => {
      const project = await seedProject(db);

      const request = new Request('http://localhost/v1/ingest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${project.apiKey}`,
        },
        body: JSON.stringify([]),
      });

      const event = createRequestEvent(request, db);
      const response = await POST(event as never);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('validation_error');
      expect(body.message).toContain('empty array');
    });

    it('returns error for missing level field', async () => {
      const project = await seedProject(db);

      const request = new Request('http://localhost/v1/ingest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${project.apiKey}`,
        },
        body: JSON.stringify({ message: 'No level' }),
      });

      const event = createRequestEvent(request, db);
      const response = await POST(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.accepted).toBe(0);
      expect(body.rejected).toBe(1);
      expect(body.errors[0]).toContain("missing required field 'level'");
    });

    it('returns error for invalid level value', async () => {
      const project = await seedProject(db);

      const request = new Request('http://localhost/v1/ingest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${project.apiKey}`,
        },
        body: JSON.stringify({ level: 'critical', message: 'Test' }),
      });

      const event = createRequestEvent(request, db);
      const response = await POST(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.accepted).toBe(0);
      expect(body.rejected).toBe(1);
      expect(body.errors[0]).toContain('invalid level');
      expect(body.errors[0]).toContain('debug, info, warn, error, fatal');
    });

    it('returns error for empty message', async () => {
      const project = await seedProject(db);

      const request = new Request('http://localhost/v1/ingest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${project.apiKey}`,
        },
        body: JSON.stringify({ level: 'info', message: '   ' }),
      });

      const event = createRequestEvent(request, db);
      const response = await POST(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.accepted).toBe(0);
      expect(body.rejected).toBe(1);
      expect(body.errors[0]).toContain('cannot be empty');
    });
  });

  describe('Event bus integration', () => {
    it('emits logs to event bus for real-time streaming', async () => {
      const project = await seedProject(db);
      const emittedLogs: unknown[] = [];

      logEventBus.onLog(project.id, (log) => {
        emittedLogs.push(log);
      });

      const request = new Request('http://localhost/v1/ingest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${project.apiKey}`,
        },
        body: JSON.stringify([
          { level: 'info', message: 'Log 1' },
          { level: 'warn', message: 'Log 2' },
        ]),
      });

      const event = createRequestEvent(request, db);
      await POST(event as never);

      expect(emittedLogs.length).toBe(2);
    });
  });

  describe('Incident aggregation', () => {
    it('groups dynamic error variants into one incident fingerprint', async () => {
      const project = await seedProject(db);

      const request = new Request('http://localhost/v1/ingest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${project.apiKey}`,
        },
        body: JSON.stringify([
          {
            level: 'error',
            message: 'Database timeout after 1000ms for user 123',
            service: 'api',
            sourceFile: 'src/db.ts',
            lineNumber: 44,
          },
          {
            level: 'error',
            message: 'Database timeout after 2500ms for user 999',
            service: 'api',
            sourceFile: 'src/db.ts',
            lineNumber: 44,
          },
          {
            level: 'info',
            message: 'User opened dashboard',
            service: 'api',
          },
        ]),
      });

      const event = createRequestEvent(request, db);
      const response = await POST(event as never);

      expect(response.status).toBe(200);

      const incidents = await db.select().from(incident).where(eq(incident.projectId, project.id));
      expect(incidents).toHaveLength(1);
      expect(incidents[0].totalEvents).toBe(2);

      const logs = await db.select().from(log).where(eq(log.projectId, project.id));
      const errorLogs = logs.filter((entry) => entry.level === 'error');
      const infoLogs = logs.filter((entry) => entry.level === 'info');

      expect(errorLogs).toHaveLength(2);
      expect(errorLogs[0].incidentId).toBe(incidents[0].id);
      expect(errorLogs[1].incidentId).toBe(incidents[0].id);
      expect(errorLogs[0].fingerprint).toBeTruthy();
      expect(errorLogs[0].fingerprint).toBe(errorLogs[1].fingerprint);
      expect(errorLogs[0].serviceName).toBe('api');

      expect(infoLogs).toHaveLength(1);
      expect(infoLogs[0].incidentId).toBeNull();
      expect(infoLogs[0].fingerprint).toBeNull();
    });
  });
});
