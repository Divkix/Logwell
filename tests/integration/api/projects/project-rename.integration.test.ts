import type { HttpError } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuth } from '$lib/server/auth';
import type * as schema from '$lib/server/db/schema';
import { project } from '$lib/server/db/schema';
import { setupTestDatabase } from '$lib/server/db/test-db';
import { getSession } from '$lib/server/session';
import { clearApiKeyCache } from '$lib/server/utils/api-key';
import { PATCH } from '../../../../src/routes/api/projects/[id]/+server';
import { seedProject } from '../../../fixtures/db';

/**
 * Helper to create a mock SvelteKit RequestEvent for [id] routes
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
    route: { id: '/api/projects/[id]' },
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
 * Helper to assert that a promise rejects with a SvelteKit HTTP error
 */
async function expectHttpError(
  promise: Promise<unknown>,
  expectedStatus: number,
  expectedBody?: Record<string, unknown>,
): Promise<void> {
  try {
    await promise;
    expect.fail('Expected HTTP error to be thrown');
  } catch (error) {
    const httpError = error as HttpError;
    expect(httpError.status).toBe(expectedStatus);
    if (expectedBody) {
      expect(httpError.body).toEqual(expectedBody);
    }
  }
}

describe('PATCH /api/projects/[id]', () => {
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

  describe('Authentication', () => {
    it('returns 401 for unauthenticated request', async () => {
      const testProject = await seedProject(db, { ownerId: userId });
      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'new-name' }),
      });

      const event = createRequestEvent(request, db, { id: testProject.id });
      await expectHttpError(PATCH(event as never), 401, { message: 'Unauthorized' });
    });
  });

  describe('Project Rename', () => {
    it('updates project name successfully', async () => {
      const testProject = await seedProject(db, { name: 'old-name', ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'new-name' }),
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await PATCH(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toHaveProperty('id', testProject.id);
      expect(body).toHaveProperty('name', 'new-name');
      expect(body).toHaveProperty('apiKey', testProject.apiKey);
      expect(body).toHaveProperty('updatedAt');

      // Verify in database
      const [updatedProject] = await db
        .select()
        .from(project)
        .where(eq(project.id, testProject.id));
      expect(updatedProject.name).toBe('new-name');
    });

    it('rejects duplicate project name', async () => {
      await seedProject(db, { name: 'existing-project', ownerId: userId });
      const testProject = await seedProject(db, { name: 'my-project', ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'existing-project' }),
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await PATCH(event as never);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toHaveProperty('code', 'duplicate_name');
      expect(body).toHaveProperty('message', 'A project with this name already exists');

      // Verify project name unchanged
      const [unchangedProject] = await db
        .select()
        .from(project)
        .where(eq(project.id, testProject.id));
      expect(unchangedProject.name).toBe('my-project');
    });

    it('validates name format - empty string', async () => {
      const testProject = await seedProject(db, { name: 'my-project', ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: '' }),
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await PATCH(event as never);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toHaveProperty('code', 'validation_error');
      expect(body.message).toContain('cannot be empty');
    });

    it('validates name format - exceeds max length', async () => {
      const testProject = await seedProject(db, { name: 'my-project', ownerId: userId });
      const longName = 'a'.repeat(51);

      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: longName }),
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await PATCH(event as never);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toHaveProperty('code', 'validation_error');
      expect(body.message).toContain('cannot exceed 50 characters');
    });

    it('validates name format - invalid characters', async () => {
      const testProject = await seedProject(db, { name: 'my-project', ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'invalid name!' }),
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await PATCH(event as never);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toHaveProperty('code', 'validation_error');
      expect(body.message).toContain('alphanumeric');
    });

    it('returns 404 for non-existent project', async () => {
      const request = new Request('http://localhost/api/projects/non-existent-id', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'new-name' }),
      });

      const event = createRequestEvent(request, db, { id: 'non-existent-id' }, authenticatedLocals);
      const response = await PATCH(event as never);

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body).toHaveProperty('error', 'not_found');
    });

    it('updates updatedAt timestamp', async () => {
      const testProject = await seedProject(db, { name: 'old-name', ownerId: userId });
      const originalUpdatedAt = testProject.updatedAt;

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'new-name' }),
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      await PATCH(event as never);

      const [updatedProject] = await db
        .select()
        .from(project)
        .where(eq(project.id, testProject.id));
      expect(updatedProject.updatedAt?.getTime()).toBeGreaterThan(
        originalUpdatedAt?.getTime() ?? 0,
      );
    });

    it('allows renaming to same name (no-op)', async () => {
      const testProject = await seedProject(db, { name: 'my-project', ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'my-project' }),
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await PATCH(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty('name', 'my-project');
    });

    it('accepts empty body (no updates)', async () => {
      const testProject = await seedProject(db, { name: 'my-project', ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await PATCH(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty('name', 'my-project');
    });
  });
});
