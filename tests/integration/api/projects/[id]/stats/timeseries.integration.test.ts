import type { Redirect } from '@sveltejs/kit';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuth } from '$lib/server/auth';
import type * as schema from '$lib/server/db/schema';
import { setupTestDatabase } from '$lib/server/db/test-db';
import { getSession } from '$lib/server/session';
import { clearApiKeyCache } from '$lib/server/utils/api-key';
import { GET } from '../../../../../../src/routes/api/projects/[id]/stats/timeseries/+server';
import { seedLogs, seedProject } from '../../../../../fixtures/db';

/**
 * Helper to create a mock SvelteKit RequestEvent for [id]/stats/timeseries routes
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
    route: { id: '/api/projects/[id]/stats/timeseries' },
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

describe('GET /api/projects/[id]/stats/timeseries', () => {
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
      const request = new Request(
        `http://localhost/api/projects/${testProject.id}/stats/timeseries`,
        { method: 'GET' },
      );

      const event = createRequestEvent(request, db, { id: testProject.id });
      await expectRedirect(GET(event as never), 303, '/login');
    });
  });

  describe('Project Validation', () => {
    it('returns 404 for non-existent project', async () => {
      const request = new Request(
        'http://localhost/api/projects/non-existent-id/stats/timeseries',
        { method: 'GET' },
      );

      const event = createRequestEvent(request, db, { id: 'non-existent-id' }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body).toHaveProperty('error', 'not_found');
      expect(body).toHaveProperty('message', 'Project not found');
    });
  });

  describe('Default Behavior', () => {
    it('defaults to 24h range when not specified', async () => {
      const testProject = await seedProject(db);
      const request = new Request(
        `http://localhost/api/projects/${testProject.id}/stats/timeseries`,
        { method: 'GET' },
      );

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.range).toBe('24h');
      expect(data.buckets).toHaveLength(24);
    });

    it('returns buckets for 15m range with minute granularity', async () => {
      const testProject = await seedProject(db);
      const request = new Request(
        `http://localhost/api/projects/${testProject.id}/stats/timeseries?range=15m`,
        { method: 'GET' },
      );

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);
      const data = await response.json();

      expect(data.buckets).toHaveLength(15);
      expect(data.range).toBe('15m');
    });

    it('returns buckets for 1h range with 5-minute granularity', async () => {
      const testProject = await seedProject(db);
      const request = new Request(
        `http://localhost/api/projects/${testProject.id}/stats/timeseries?range=1h`,
        { method: 'GET' },
      );

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);
      const data = await response.json();

      expect(data.buckets).toHaveLength(12);
      expect(data.range).toBe('1h');
    });

    it('returns buckets for 7d range with 6-hour granularity', async () => {
      const testProject = await seedProject(db);
      const request = new Request(
        `http://localhost/api/projects/${testProject.id}/stats/timeseries?range=7d`,
        { method: 'GET' },
      );

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);
      const data = await response.json();

      expect(data.buckets).toHaveLength(28);
      expect(data.range).toBe('7d');
    });

    it('falls back to 24h for invalid range parameter', async () => {
      const testProject = await seedProject(db);
      const request = new Request(
        `http://localhost/api/projects/${testProject.id}/stats/timeseries?range=invalid`,
        { method: 'GET' },
      );

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);
      const data = await response.json();

      expect(data.range).toBe('24h');
      expect(data.buckets).toHaveLength(24);
    });
  });

  describe('Empty State', () => {
    it('returns all zero counts when no logs in range', async () => {
      const testProject = await seedProject(db);
      // Don't seed any logs

      const request = new Request(
        `http://localhost/api/projects/${testProject.id}/stats/timeseries?range=24h`,
        { method: 'GET' },
      );

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);
      const data = await response.json();

      expect(data.buckets.every((b: { count: number }) => b.count === 0)).toBe(true);
      expect(data.totalCount).toBe(0);
    });
  });

  describe('Log Counting', () => {
    it('returns correct count per bucket', async () => {
      const testProject = await seedProject(db);
      const now = new Date();

      // Seed exactly 7 logs 30 minutes ago (should be in one specific bucket for 1h range)
      const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);
      await seedLogs(db, testProject.id, 7, { timestamp: thirtyMinAgo });

      const request = new Request(
        `http://localhost/api/projects/${testProject.id}/stats/timeseries?range=1h`,
        { method: 'GET' },
      );

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);
      const data = await response.json();

      // Find the bucket with logs (should have count 7)
      const nonZeroBuckets = data.buckets.filter((b: { count: number }) => b.count > 0);
      expect(nonZeroBuckets).toHaveLength(1);
      expect(nonZeroBuckets[0].count).toBe(7);
      expect(data.totalCount).toBe(7);
    });

    it('returns buckets with logs at different times', async () => {
      const testProject = await seedProject(db);
      const now = new Date();

      // Seed logs at different hours
      await seedLogs(db, testProject.id, 5, {
        timestamp: new Date(now.getTime() - 2 * 60 * 60 * 1000), // 2 hours ago
      });
      await seedLogs(db, testProject.id, 3, {
        timestamp: new Date(now.getTime() - 5 * 60 * 60 * 1000), // 5 hours ago
      });

      const request = new Request(
        `http://localhost/api/projects/${testProject.id}/stats/timeseries?range=24h`,
        { method: 'GET' },
      );

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.buckets).toHaveLength(24);
      expect(data.totalCount).toBe(8);
    });
  });

  describe('Bucket Order', () => {
    it('returns buckets in chronological order', async () => {
      const testProject = await seedProject(db);
      const request = new Request(
        `http://localhost/api/projects/${testProject.id}/stats/timeseries?range=24h`,
        { method: 'GET' },
      );

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);
      const data = await response.json();

      const timestamps = data.buckets.map((b: { timestamp: string }) =>
        new Date(b.timestamp).getTime(),
      );
      const sorted = [...timestamps].sort((a, b) => a - b);

      expect(timestamps).toEqual(sorted);
    });

    it('returns buckets with valid ISO timestamps', async () => {
      const testProject = await seedProject(db);
      const request = new Request(
        `http://localhost/api/projects/${testProject.id}/stats/timeseries?range=24h`,
        { method: 'GET' },
      );

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);
      const data = await response.json();

      for (const bucket of data.buckets) {
        const date = new Date(bucket.timestamp);
        expect(date.toISOString()).toBe(bucket.timestamp);
      }
    });
  });

  describe('Project Isolation', () => {
    it('respects projectId filter (no cross-project leakage)', async () => {
      const project1 = await seedProject(db, { name: 'Project 1' });
      const project2 = await seedProject(db, { name: 'Project 2' });

      const now = new Date();
      await seedLogs(db, project1.id, 10, { timestamp: now });
      await seedLogs(db, project2.id, 5, { timestamp: now });

      const request = new Request(
        `http://localhost/api/projects/${project1.id}/stats/timeseries?range=24h`,
        { method: 'GET' },
      );

      const event = createRequestEvent(request, db, { id: project1.id }, authenticatedLocals);
      const response = await GET(event as never);
      const data = await response.json();

      expect(data.totalCount).toBe(10); // Only project1 logs
    });
  });

  describe('Time Range Boundary', () => {
    it('excludes logs outside the time range', async () => {
      const testProject = await seedProject(db);
      const now = new Date();

      // Seed old logs (before the 24h range - should be excluded)
      await seedLogs(db, testProject.id, 10, {
        timestamp: new Date(now.getTime() - 25 * 60 * 60 * 1000), // 25 hours ago
      });
      // Seed recent logs (within the 24h range - should be included)
      await seedLogs(db, testProject.id, 5, {
        timestamp: new Date(now.getTime() - 1 * 60 * 60 * 1000), // 1 hour ago
      });

      const request = new Request(
        `http://localhost/api/projects/${testProject.id}/stats/timeseries?range=24h`,
        { method: 'GET' },
      );

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);
      const data = await response.json();

      // Should only count the 5 recent logs
      expect(data.totalCount).toBe(5);
    });
  });
});
