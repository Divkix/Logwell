import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuth } from '$lib/server/auth';
import type * as schema from '$lib/server/db/schema';
import { setupTestDatabase } from '$lib/server/db/test-db';
import { getSession } from '$lib/server/session';
import { POST as POST_PROJECTS } from '../../../../src/routes/api/projects/+server';
import { DELETE, PATCH } from '../../../../src/routes/api/projects/[id]/+server';
import { POST as POST_REGENERATE } from '../../../../src/routes/api/projects/[id]/regenerate/+server';
import { seedProject } from '../../../fixtures/db';

/**
 * Helper to create a mock SvelteKit RequestEvent
 */
function createRequestEvent(
  request: Request,
  db: PgliteDatabase<typeof schema>,
  locals: Partial<App.Locals> = {},
  params: Record<string, string> = {},
) {
  return {
    request,
    locals: { db, ...locals },
    params,
    url: new URL(request.url),
    platform: undefined,
    route: { id: '/api/projects' },
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

describe('CSRF Origin/Referer checks', () => {
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

    const signUpResult = await auth.api.signUpEmail({
      body: {
        email: 'csrf-test@example.com',
        password: 'SecureP@ssw0rd123',
        name: 'CSRF Test User',
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

  describe('POST /api/projects', () => {
    it('rejects request with mismatched Origin header', async () => {
      const request = new Request('http://localhost/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://evil.com',
        },
        body: JSON.stringify({ name: 'csrf-test' }),
      });

      const event = createRequestEvent(request, db, authenticatedLocals);
      const response = await POST_PROJECTS(event as never);

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe('csrf_error');
    });

    it('rejects request with mismatched Referer header', async () => {
      const request = new Request('http://localhost/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Referer: 'https://evil.com/phishing',
        },
        body: JSON.stringify({ name: 'csrf-test' }),
      });

      const event = createRequestEvent(request, db, authenticatedLocals);
      const response = await POST_PROJECTS(event as never);

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe('csrf_error');
    });

    it('allows request with valid Origin header', async () => {
      const request = new Request('http://localhost/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost',
        },
        body: JSON.stringify({ name: 'csrf-valid' }),
      });

      const event = createRequestEvent(request, db, authenticatedLocals);
      const response = await POST_PROJECTS(event as never);

      expect(response.status).toBe(201);
    });

    it('allows request with valid Referer header', async () => {
      const request = new Request('http://localhost/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Referer: 'http://localhost/projects',
        },
        body: JSON.stringify({ name: 'csrf-valid-ref' }),
      });

      const event = createRequestEvent(request, db, authenticatedLocals);
      const response = await POST_PROJECTS(event as never);

      expect(response.status).toBe(201);
    });

    it('allows request without Origin or Referer (same-origin fallback)', async () => {
      const request = new Request('http://localhost/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'csrf-no-headers' }),
      });

      const event = createRequestEvent(request, db, authenticatedLocals);
      const response = await POST_PROJECTS(event as never);

      expect(response.status).toBe(201);
    });
  });

  describe('PATCH /api/projects/[id]', () => {
    it('rejects request with mismatched Origin header', async () => {
      const testProject = await seedProject(db, { ownerId: userId });
      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://evil.com',
        },
        body: JSON.stringify({ name: 'hacked' }),
      });

      const event = createRequestEvent(request, db, authenticatedLocals, { id: testProject.id });
      const response = await PATCH(event as never);

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe('csrf_error');
    });

    it('allows request with valid Origin header', async () => {
      const testProject = await seedProject(db, { ownerId: userId });
      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost',
        },
        body: JSON.stringify({ name: 'valid-patch' }),
      });

      const event = createRequestEvent(request, db, authenticatedLocals, { id: testProject.id });
      const response = await PATCH(event as never);

      expect(response.status).toBe(200);
    });
  });

  describe('DELETE /api/projects/[id]', () => {
    it('rejects request with mismatched Origin header', async () => {
      const testProject = await seedProject(db, { ownerId: userId });
      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: 'DELETE',
        headers: {
          Origin: 'https://evil.com',
        },
      });

      const event = createRequestEvent(request, db, authenticatedLocals, { id: testProject.id });
      const response = await DELETE(event as never);

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe('csrf_error');
    });

    it('allows request with valid Origin header', async () => {
      const testProject = await seedProject(db, { ownerId: userId });
      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: 'DELETE',
        headers: {
          Origin: 'http://localhost',
        },
      });

      const event = createRequestEvent(request, db, authenticatedLocals, { id: testProject.id });
      const response = await DELETE(event as never);

      expect(response.status).toBe(200);
    });
  });

  describe('POST /api/projects/[id]/regenerate', () => {
    it('rejects request with mismatched Origin header', async () => {
      const testProject = await seedProject(db, { ownerId: userId });
      const request = new Request(`http://localhost/api/projects/${testProject.id}/regenerate`, {
        method: 'POST',
        headers: {
          Origin: 'https://evil.com',
        },
      });

      const event = createRequestEvent(request, db, authenticatedLocals, { id: testProject.id });
      const response = await POST_REGENERATE(event as never);

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe('csrf_error');
    });

    it('allows request with valid Origin header', async () => {
      const testProject = await seedProject(db, { ownerId: userId });
      const request = new Request(`http://localhost/api/projects/${testProject.id}/regenerate`, {
        method: 'POST',
        headers: {
          Origin: 'http://localhost',
        },
      });

      const event = createRequestEvent(request, db, authenticatedLocals, { id: testProject.id });
      const response = await POST_REGENERATE(event as never);

      expect(response.status).toBe(200);
    });
  });
});
