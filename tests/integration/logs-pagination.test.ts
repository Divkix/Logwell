import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuth } from '$lib/server/auth';
import type * as schema from '$lib/server/db/schema';
import { setupTestDatabase } from '$lib/server/db/test-db';
import { getSession } from '$lib/server/session';
import { clearApiKeyCache } from '$lib/server/utils/api-key';
import { GET } from '../../src/routes/api/projects/[id]/logs/+server';
import { seedLog, seedLogs, seedProject } from '../fixtures/db';

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

describe('Cursor-based Pagination', () => {
  let db: PgliteDatabase<typeof schema>;
  let cleanup: () => Promise<void>;
  let auth: ReturnType<typeof createAuth>;
  let authenticatedLocals: Partial<App.Locals>;
  let userId: string;

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

    userId = sessionData.user.id;
    authenticatedLocals = {
      user: sessionData.user,
      session: sessionData.session,
    };
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('Basic Cursor Pagination', () => {
    it('returns nextCursor when more logs exist', async () => {
      const testProject = await seedProject(db, { ownerId: userId });

      // Create 150 logs (more than default limit of 100)
      await seedLogs(db, testProject.id, 150);

      const request = new Request(`http://localhost/api/projects/${testProject.id}/logs`, {
        method: 'GET',
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body.logs).toHaveLength(100); // Default limit
      expect(body.has_more).toBe(true);
      expect(body.nextCursor).toBeTruthy();
      expect(typeof body.nextCursor).toBe('string');
    });

    it('returns null nextCursor when no more logs exist', async () => {
      const testProject = await seedProject(db, { ownerId: userId });

      // Create 50 logs (less than default limit)
      await seedLogs(db, testProject.id, 50);

      const request = new Request(`http://localhost/api/projects/${testProject.id}/logs`, {
        method: 'GET',
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body.logs).toHaveLength(50);
      expect(body.has_more).toBe(false);
      expect(body.nextCursor).toBeNull();
    });

    it('fetches next page using cursor', async () => {
      const testProject = await seedProject(db, { ownerId: userId });

      // Create logs with specific timestamps to verify ordering
      const now = new Date();
      const logs = [];
      for (let i = 0; i < 5; i++) {
        const log = await seedLog(db, testProject.id, {
          message: `Log ${i}`,
          timestamp: new Date(now.getTime() - (5 - i) * 1000), // Oldest to newest
        });
        logs.push(log);
      }

      // First request - get first 2 logs
      const request1 = new Request(
        `http://localhost/api/projects/${testProject.id}/logs?limit=100`,
        { method: 'GET' },
      );

      const event1 = createRequestEvent(request1, db, { id: testProject.id }, authenticatedLocals);
      const response1 = await GET(event1 as never);

      expect(response1.status).toBe(200);
      const body1 = await response1.json();

      expect(body1.logs).toHaveLength(5);
      // Logs should be ordered newest first
      expect(body1.logs[0]?.id).toBe(logs[4]?.id); // Newest
      expect(body1.logs[4]?.id).toBe(logs[0]?.id); // Oldest

      // Create 150 more logs to test pagination
      await seedLogs(db, testProject.id, 150);

      // Get first page
      const request2 = new Request(`http://localhost/api/projects/${testProject.id}/logs`, {
        method: 'GET',
      });

      const event2 = createRequestEvent(request2, db, { id: testProject.id }, authenticatedLocals);
      const response2 = await GET(event2 as never);
      const body2 = await response2.json();

      expect(body2.nextCursor).toBeTruthy();

      // Use cursor to get next page
      const request3 = new Request(
        `http://localhost/api/projects/${testProject.id}/logs?cursor=${body2.nextCursor}`,
        { method: 'GET' },
      );

      const event3 = createRequestEvent(request3, db, { id: testProject.id }, authenticatedLocals);
      const response3 = await GET(event3 as never);

      expect(response3.status).toBe(200);
      const body3 = await response3.json();

      // Should get the remaining logs
      expect(body3.logs.length).toBeGreaterThan(0);
      // No duplicate IDs between pages
      const page1Ids = new Set(body2.logs.map((l: { id: string }) => l.id));
      const page2Ids = new Set(body3.logs.map((l: { id: string }) => l.id));
      const intersection = [...page1Ids].filter((id) => page2Ids.has(id));
      expect(intersection).toHaveLength(0);
    });

    it('returns 400 for invalid cursor', async () => {
      const testProject = await seedProject(db, { ownerId: userId });

      const request = new Request(
        `http://localhost/api/projects/${testProject.id}/logs?cursor=invalid-cursor-123`,
        { method: 'GET' },
      );

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.code).toBe('invalid_cursor');
    });
  });

  describe('Cursor with Filters', () => {
    it('maintains level filter across cursor pagination', async () => {
      const testProject = await seedProject(db, { ownerId: userId });

      // Create mixed logs - 200 error logs and 100 info logs
      await seedLogs(db, testProject.id, 200, { level: 'error' });
      await seedLogs(db, testProject.id, 100, { level: 'info' });

      // First page with level filter
      const request1 = new Request(
        `http://localhost/api/projects/${testProject.id}/logs?level=error&limit=100`,
        { method: 'GET' },
      );

      const event1 = createRequestEvent(request1, db, { id: testProject.id }, authenticatedLocals);
      const response1 = await GET(event1 as never);
      const body1 = await response1.json();

      expect(body1.logs).toHaveLength(100);
      expect(body1.logs.every((l: { level: string }) => l.level === 'error')).toBe(true);
      expect(body1.nextCursor).toBeTruthy();

      // Second page with cursor and level filter
      const request2 = new Request(
        `http://localhost/api/projects/${testProject.id}/logs?level=error&cursor=${body1.nextCursor}`,
        { method: 'GET' },
      );

      const event2 = createRequestEvent(request2, db, { id: testProject.id }, authenticatedLocals);
      const response2 = await GET(event2 as never);
      const body2 = await response2.json();

      expect(body2.logs).toHaveLength(100);
      expect(body2.logs.every((l: { level: string }) => l.level === 'error')).toBe(true);
    });

    it('maintains search filter across cursor pagination', async () => {
      const testProject = await seedProject(db, { ownerId: userId });

      // Create 200 logs with "database" in message
      for (let i = 0; i < 200; i++) {
        await seedLog(db, testProject.id, { message: `Database query ${i}` });
      }

      // Create 50 other logs
      await seedLogs(db, testProject.id, 50, { message: 'Other log message' });

      // First page with search
      const request1 = new Request(
        `http://localhost/api/projects/${testProject.id}/logs?search=database&limit=100`,
        { method: 'GET' },
      );

      const event1 = createRequestEvent(request1, db, { id: testProject.id }, authenticatedLocals);
      const response1 = await GET(event1 as never);
      const body1 = await response1.json();

      expect(body1.logs).toHaveLength(100);
      expect(body1.nextCursor).toBeTruthy();

      // Second page with cursor and search
      const request2 = new Request(
        `http://localhost/api/projects/${testProject.id}/logs?search=database&cursor=${body1.nextCursor}`,
        { method: 'GET' },
      );

      const event2 = createRequestEvent(request2, db, { id: testProject.id }, authenticatedLocals);
      const response2 = await GET(event2 as never);
      const body2 = await response2.json();

      expect(body2.logs).toHaveLength(100);
    });

    it('maintains time range filter across cursor pagination', async () => {
      const testProject = await seedProject(db, { ownerId: userId });

      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      // Create 150 logs within the time range
      for (let i = 0; i < 150; i++) {
        await seedLog(db, testProject.id, {
          message: `Log ${i}`,
          timestamp: new Date(oneHourAgo.getTime() + i * 1000),
        });
      }

      // Create logs outside the range
      await seedLogs(db, testProject.id, 50, { timestamp: twoHoursAgo });

      // First page with time range
      const request1 = new Request(
        `http://localhost/api/projects/${testProject.id}/logs?from=${oneHourAgo.toISOString()}&limit=100`,
        { method: 'GET' },
      );

      const event1 = createRequestEvent(request1, db, { id: testProject.id }, authenticatedLocals);
      const response1 = await GET(event1 as never);
      const body1 = await response1.json();

      expect(body1.logs).toHaveLength(100);
      expect(body1.nextCursor).toBeTruthy();

      // Second page with cursor and time range
      const request2 = new Request(
        `http://localhost/api/projects/${testProject.id}/logs?from=${oneHourAgo.toISOString()}&cursor=${body1.nextCursor}`,
        { method: 'GET' },
      );

      const event2 = createRequestEvent(request2, db, { id: testProject.id }, authenticatedLocals);
      const response2 = await GET(event2 as never);
      const body2 = await response2.json();

      expect(body2.logs).toHaveLength(50);
      expect(body2.nextCursor).toBeNull(); // No more logs
    });
  });

  describe('Edge Cases', () => {
    it('handles empty cursor correctly', async () => {
      const testProject = await seedProject(db, { ownerId: userId });
      await seedLogs(db, testProject.id, 50);

      const request = new Request(`http://localhost/api/projects/${testProject.id}/logs?cursor=`, {
        method: 'GET',
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);

      // Empty cursor should be ignored, treated as no cursor
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.logs).toHaveLength(50);
    });

    it('handles cursor pointing to last log', async () => {
      const testProject = await seedProject(db, { ownerId: userId });

      // Create exactly 100 logs
      await seedLogs(db, testProject.id, 100);

      // Get first page
      const request1 = new Request(`http://localhost/api/projects/${testProject.id}/logs`, {
        method: 'GET',
      });

      const event1 = createRequestEvent(request1, db, { id: testProject.id }, authenticatedLocals);
      const response1 = await GET(event1 as never);
      const body1 = await response1.json();

      expect(body1.logs).toHaveLength(100);
      expect(body1.nextCursor).toBeNull(); // No more logs

      // Try to use cursor (shouldn't exist but testing edge case)
      if (body1.nextCursor) {
        const request2 = new Request(
          `http://localhost/api/projects/${testProject.id}/logs?cursor=${body1.nextCursor}`,
          { method: 'GET' },
        );

        const event2 = createRequestEvent(
          request2,
          db,
          { id: testProject.id },
          authenticatedLocals,
        );
        const response2 = await GET(event2 as never);
        const body2 = await response2.json();

        expect(body2.logs).toHaveLength(0);
        expect(body2.nextCursor).toBeNull();
      }
    });
  });
});
