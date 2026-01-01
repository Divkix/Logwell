import type { Redirect } from '@sveltejs/kit';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuth } from '$lib/server/auth';
import type * as schema from '$lib/server/db/schema';
import { setupTestDatabase } from '$lib/server/db/test-db';
import { getSession } from '$lib/server/session';
import { clearApiKeyCache } from '$lib/server/utils/api-key';
import { GET } from '../../../../../src/routes/api/projects/[id]/logs/+server';
import { seedLog, seedLogs, seedProject } from '../../../../fixtures/db';

/**
 * Helper to create a mock SvelteKit RequestEvent for [id]/logs routes
 */
function createRequestEvent(
  request: Request,
  db: PgliteDatabase<typeof schema>,
  params: { id: string },
  locals: Partial<App.Locals> = {},
) {
  return {
    request,
    locals: { db, ...locals },
    params,
    url: new URL(request.url),
    platform: undefined,
    route: { id: '/api/projects/[id]/logs' },
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

/**
 * Helper to assert that a promise rejects with a SvelteKit redirect
 */
async function expectRedirect(
  promise: Promise<unknown>,
  expectedStatus: number,
  expectedLocation: string,
): Promise<void> {
  try {
    await promise;
    expect.fail('Expected redirect to be thrown');
  } catch (error) {
    const redirect = error as Redirect;
    expect(redirect.status).toBe(expectedStatus);
    expect(redirect.location).toBe(expectedLocation);
  }
}

describe('GET /api/projects/[id]/logs', () => {
  let db: PgliteDatabase<typeof schema>;
  let cleanup: () => Promise<void>;
  let auth: ReturnType<typeof createAuth>;
  let authenticatedLocals: Partial<App.Locals>;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
    auth = createAuth(db);
    clearApiKeyCache();

    // Create authenticated user
    const signUpResult = await auth.api.signUpEmail({
      body: {
        email: 'test@example.com',
        password: 'SecureP@ssw0rd123',
        name: 'Test User',
      },
    });

    const mockRequest = new Request('http://localhost:5173', {
      headers: {
        cookie: `better-auth.session_token=${signUpResult.token}`,
      },
    });

    const sessionData = await getSession(mockRequest.headers, db);
    if (!sessionData) throw new Error('Session data should not be null');

    authenticatedLocals = {
      user: sessionData.user,
      session: sessionData.session,
    };
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('Authentication', () => {
    it('throws redirect for unauthenticated request', async () => {
      const testProject = await seedProject(db);
      const request = new Request(`http://localhost/api/projects/${testProject.id}/logs`, {
        method: 'GET',
      });

      const event = createRequestEvent(request, db, { id: testProject.id });
      await expectRedirect(GET(event as never), 303, '/login');
    });
  });

  describe('Ordering', () => {
    it('returns logs ordered by timestamp DESC', async () => {
      const testProject = await seedProject(db);

      // Create logs with specific timestamps to verify ordering
      const now = new Date();
      const log1 = await seedLog(db, testProject.id, {
        message: 'First log',
        timestamp: new Date(now.getTime() - 3000), // oldest
      });
      const log2 = await seedLog(db, testProject.id, {
        message: 'Second log',
        timestamp: new Date(now.getTime() - 2000),
      });
      const log3 = await seedLog(db, testProject.id, {
        message: 'Third log',
        timestamp: new Date(now.getTime() - 1000), // newest
      });

      const request = new Request(`http://localhost/api/projects/${testProject.id}/logs`, {
        method: 'GET',
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body.logs).toHaveLength(3);
      // Logs should be ordered newest first (DESC)
      expect(body.logs[0].id).toBe(log3.id);
      expect(body.logs[1].id).toBe(log2.id);
      expect(body.logs[2].id).toBe(log1.id);
    });
  });

  describe('Limit Parameter', () => {
    it('respects limit parameter (default 100)', async () => {
      const testProject = await seedProject(db);
      await seedLogs(db, testProject.id, 150); // More than default limit

      const request = new Request(`http://localhost/api/projects/${testProject.id}/logs`, {
        method: 'GET',
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body.logs).toHaveLength(100); // Default limit
    });

    it('accepts custom limit within range (100-500)', async () => {
      const testProject = await seedProject(db);
      await seedLogs(db, testProject.id, 300);

      const request = new Request(
        `http://localhost/api/projects/${testProject.id}/logs?limit=200`,
        { method: 'GET' },
      );

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body.logs).toHaveLength(200);
    });

    it('clamps limit to minimum 100', async () => {
      const testProject = await seedProject(db);
      await seedLogs(db, testProject.id, 150);

      const request = new Request(`http://localhost/api/projects/${testProject.id}/logs?limit=50`, {
        method: 'GET',
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      // Should clamp to minimum 100
      expect(body.logs).toHaveLength(100);
    });

    it('clamps limit to maximum 500', async () => {
      const testProject = await seedProject(db);
      await seedLogs(db, testProject.id, 600);

      const request = new Request(
        `http://localhost/api/projects/${testProject.id}/logs?limit=1000`,
        { method: 'GET' },
      );

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      // Should clamp to maximum 500
      expect(body.logs).toHaveLength(500);
    });
  });

  describe('Offset Parameter', () => {
    it('respects offset parameter for pagination', async () => {
      const testProject = await seedProject(db);

      // Create logs with specific order
      const now = new Date();
      const logs = [];
      for (let i = 0; i < 5; i++) {
        const log = await seedLog(db, testProject.id, {
          message: `Log ${i}`,
          timestamp: new Date(now.getTime() - (5 - i) * 1000),
        });
        logs.push(log);
      }

      // Request with offset=2
      const request = new Request(
        `http://localhost/api/projects/${testProject.id}/logs?limit=100&offset=2`,
        { method: 'GET' },
      );

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      // Should skip the first 2 logs (newest) and return remaining 3
      expect(body.logs).toHaveLength(3);
      expect(body.logs[0].id).toBe(logs[2].id);
    });
  });

  describe('Level Filter', () => {
    it('filters by single level parameter', async () => {
      const testProject = await seedProject(db);
      await seedLogs(db, testProject.id, 5, { level: 'info' });
      await seedLogs(db, testProject.id, 3, { level: 'error' });
      await seedLogs(db, testProject.id, 2, { level: 'debug' });

      const request = new Request(
        `http://localhost/api/projects/${testProject.id}/logs?level=error`,
        { method: 'GET' },
      );

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body.logs).toHaveLength(3);
      expect(body.logs.every((log: { level: string }) => log.level === 'error')).toBe(true);
    });

    it('filters by multiple comma-separated levels', async () => {
      const testProject = await seedProject(db);
      await seedLogs(db, testProject.id, 5, { level: 'info' });
      await seedLogs(db, testProject.id, 3, { level: 'error' });
      await seedLogs(db, testProject.id, 2, { level: 'debug' });
      await seedLogs(db, testProject.id, 4, { level: 'warn' });

      const request = new Request(
        `http://localhost/api/projects/${testProject.id}/logs?level=error,fatal`,
        { method: 'GET' },
      );

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body.logs).toHaveLength(3); // Only error logs, no fatal
      expect(
        body.logs.every((log: { level: string }) => ['error', 'fatal'].includes(log.level)),
      ).toBe(true);
    });
  });

  describe('Time Range Filter', () => {
    it('filters by from timestamp', async () => {
      const testProject = await seedProject(db);

      const now = new Date();
      // Old log (before the 'from' filter - should be excluded)
      await seedLog(db, testProject.id, {
        message: 'Old log',
        timestamp: new Date(now.getTime() - 3600000), // 1 hour ago
      });
      const recentLog = await seedLog(db, testProject.id, {
        message: 'Recent log',
        timestamp: new Date(now.getTime() - 60000), // 1 minute ago
      });

      // Filter for logs from 30 minutes ago
      const fromTime = new Date(now.getTime() - 1800000).toISOString();
      const request = new Request(
        `http://localhost/api/projects/${testProject.id}/logs?from=${fromTime}`,
        { method: 'GET' },
      );

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body.logs).toHaveLength(1);
      expect(body.logs[0].id).toBe(recentLog.id);
    });

    it('filters by to timestamp', async () => {
      const testProject = await seedProject(db);

      const now = new Date();
      const oldLog = await seedLog(db, testProject.id, {
        message: 'Old log',
        timestamp: new Date(now.getTime() - 3600000), // 1 hour ago
      });
      // Recent log (after the 'to' filter - should be excluded)
      await seedLog(db, testProject.id, {
        message: 'Recent log',
        timestamp: new Date(now.getTime() - 60000), // 1 minute ago
      });

      // Filter for logs up to 30 minutes ago
      const toTime = new Date(now.getTime() - 1800000).toISOString();
      const request = new Request(
        `http://localhost/api/projects/${testProject.id}/logs?to=${toTime}`,
        { method: 'GET' },
      );

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body.logs).toHaveLength(1);
      expect(body.logs[0].id).toBe(oldLog.id);
    });

    it('filters by both from and to timestamps', async () => {
      const testProject = await seedProject(db);

      const now = new Date();
      await seedLog(db, testProject.id, {
        message: 'Very old log',
        timestamp: new Date(now.getTime() - 7200000), // 2 hours ago
      });
      const middleLog = await seedLog(db, testProject.id, {
        message: 'Middle log',
        timestamp: new Date(now.getTime() - 3600000), // 1 hour ago
      });
      await seedLog(db, testProject.id, {
        message: 'Recent log',
        timestamp: new Date(now.getTime() - 60000), // 1 minute ago
      });

      // Filter for logs between 90 minutes ago and 30 minutes ago
      const fromTime = new Date(now.getTime() - 5400000).toISOString();
      const toTime = new Date(now.getTime() - 1800000).toISOString();
      const request = new Request(
        `http://localhost/api/projects/${testProject.id}/logs?from=${fromTime}&to=${toTime}`,
        { method: 'GET' },
      );

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body.logs).toHaveLength(1);
      expect(body.logs[0].id).toBe(middleLog.id);
    });
  });

  describe('Full-Text Search', () => {
    it('performs full-text search on message', async () => {
      const testProject = await seedProject(db);

      await seedLog(db, testProject.id, { message: 'Database connection failed' });
      await seedLog(db, testProject.id, { message: 'User logged in successfully' });
      await seedLog(db, testProject.id, { message: 'Database query timeout' });

      const request = new Request(
        `http://localhost/api/projects/${testProject.id}/logs?search=database`,
        { method: 'GET' },
      );

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body.logs).toHaveLength(2);
      expect(
        body.logs.every((log: { message: string }) =>
          log.message.toLowerCase().includes('database'),
        ),
      ).toBe(true);
    });

    it('performs full-text search on metadata', async () => {
      const testProject = await seedProject(db);

      await seedLog(db, testProject.id, {
        message: 'Error occurred',
        metadata: { service: 'payment-gateway', error_code: 'PAYMENT_FAILED' },
      });
      await seedLog(db, testProject.id, {
        message: 'Request processed',
        metadata: { service: 'user-service' },
      });

      const request = new Request(
        `http://localhost/api/projects/${testProject.id}/logs?search=payment`,
        { method: 'GET' },
      );

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body.logs).toHaveLength(1);
      expect(body.logs[0].metadata).toHaveProperty('service', 'payment-gateway');
    });

    it('handles multi-word search query', async () => {
      const testProject = await seedProject(db);

      await seedLog(db, testProject.id, { message: 'Database connection failed' });
      await seedLog(db, testProject.id, { message: 'Database query succeeded' });
      await seedLog(db, testProject.id, { message: 'Connection timeout' });

      const request = new Request(
        `http://localhost/api/projects/${testProject.id}/logs?search=connection+failed`,
        { method: 'GET' },
      );

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      // Should match logs containing both "connection" and "failed"
      expect(body.logs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Pagination Response', () => {
    it('returns total count and has_more flag', async () => {
      const testProject = await seedProject(db);
      await seedLogs(db, testProject.id, 150);

      const request = new Request(
        `http://localhost/api/projects/${testProject.id}/logs?limit=100`,
        { method: 'GET' },
      );

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toHaveProperty('total', 150);
      expect(body).toHaveProperty('has_more', true);
      expect(body.logs).toHaveLength(100);
    });

    it('returns has_more=false when all logs returned', async () => {
      const testProject = await seedProject(db);
      await seedLogs(db, testProject.id, 50);

      const request = new Request(
        `http://localhost/api/projects/${testProject.id}/logs?limit=100`,
        { method: 'GET' },
      );

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toHaveProperty('total', 50);
      expect(body).toHaveProperty('has_more', false);
      expect(body.logs).toHaveLength(50);
    });

    it('returns correct total with filters applied', async () => {
      const testProject = await seedProject(db);
      await seedLogs(db, testProject.id, 100, { level: 'info' });
      await seedLogs(db, testProject.id, 30, { level: 'error' });

      const request = new Request(
        `http://localhost/api/projects/${testProject.id}/logs?level=error`,
        { method: 'GET' },
      );

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toHaveProperty('total', 30);
      expect(body).toHaveProperty('has_more', false);
      expect(body.logs).toHaveLength(30);
    });
  });

  describe('Project Validation', () => {
    it('returns 404 for non-existent project', async () => {
      const request = new Request('http://localhost/api/projects/non-existent-id/logs', {
        method: 'GET',
      });

      const event = createRequestEvent(request, db, { id: 'non-existent-id' }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body).toHaveProperty('error', 'not_found');
    });
  });

  describe('Empty State', () => {
    it('returns empty array when project has no logs', async () => {
      const testProject = await seedProject(db);

      const request = new Request(`http://localhost/api/projects/${testProject.id}/logs`, {
        method: 'GET',
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body.logs).toHaveLength(0);
      expect(body.total).toBe(0);
      expect(body.has_more).toBe(false);
    });
  });

  describe('Log Fields', () => {
    it('returns all log fields in response', async () => {
      const testProject = await seedProject(db);

      const log = await seedLog(db, testProject.id, {
        message: 'Test message',
        level: 'error',
        metadata: { key: 'value' },
        sourceFile: 'src/test.ts',
        lineNumber: 42,
        requestId: 'req_123',
        userId: 'user_456',
        ipAddress: '192.168.1.1',
      });

      const request = new Request(`http://localhost/api/projects/${testProject.id}/logs`, {
        method: 'GET',
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body.logs).toHaveLength(1);
      const returnedLog = body.logs[0];

      expect(returnedLog).toHaveProperty('id', log.id);
      expect(returnedLog).toHaveProperty('level', 'error');
      expect(returnedLog).toHaveProperty('message', 'Test message');
      expect(returnedLog).toHaveProperty('metadata', { key: 'value' });
      expect(returnedLog).toHaveProperty('sourceFile', 'src/test.ts');
      expect(returnedLog).toHaveProperty('lineNumber', 42);
      expect(returnedLog).toHaveProperty('requestId', 'req_123');
      expect(returnedLog).toHaveProperty('userId', 'user_456');
      expect(returnedLog).toHaveProperty('ipAddress', '192.168.1.1');
      expect(returnedLog).toHaveProperty('timestamp');
      // Should NOT return the search vector field
      expect(returnedLog).not.toHaveProperty('search');
    });
  });
});
