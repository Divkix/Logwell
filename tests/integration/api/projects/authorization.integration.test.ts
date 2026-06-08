import { eq } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuth } from '$lib/server/auth';
import type * as schema from '$lib/server/db/schema';
import { project } from '$lib/server/db/schema';
import { setupTestDatabase } from '$lib/server/db/test-db';
import { getSession } from '$lib/server/session';
import { hashApiKey } from '$lib/server/utils/api-key';
import {
  GET as GET_PROJECTS,
  POST as POST_PROJECTS,
} from '../../../../src/routes/api/projects/+server';
import {
  DELETE,
  GET as GET_PROJECT,
  PATCH,
} from '../../../../src/routes/api/projects/[id]/+server';
import { GET as GET_LOGS } from '../../../../src/routes/api/projects/[id]/logs/+server';
import { POST as POST_REGENERATE } from '../../../../src/routes/api/projects/[id]/regenerate/+server';
import { GET as GET_STATS } from '../../../../src/routes/api/projects/[id]/stats/+server';
import { seedProject, seedProjectWithApiKey } from '../../../fixtures/db';

/**
 * Helper to create a mock SvelteKit RequestEvent for session-authenticated routes
 */
function createRequestEvent(
  request: Request,
  db: PgliteDatabase<typeof schema>,
  params: Record<string, string> = {},
  locals: Partial<App.Locals> = {},
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

/**
 * Helper to create an authenticated user and return their locals
 */
async function createAuthenticatedUser(
  db: PgliteDatabase<typeof schema>,
  auth: ReturnType<typeof createAuth>,
  email: string,
  name: string,
): Promise<{ locals: Partial<App.Locals>; userId: string }> {
  const signUpResult = await auth.api.signUpEmail({
    body: {
      email,
      password: 'SecureP@ssw0rd123',
      name,
    },
  });

  const mockRequest = new Request('http://localhost:5173', {
    headers: {
      cookie: `better-auth.session_token=${signUpResult.token}`,
    },
  });

  const sessionData = await getSession(mockRequest.headers, db);
  if (!sessionData) throw new Error('Session data should not be null');

  return {
    locals: {
      user: sessionData.user,
      session: sessionData.session,
    },
    userId: sessionData.user.id,
  };
}

describe('Project Authorization - Ownership Isolation', () => {
  let db: PgliteDatabase<typeof schema>;
  let cleanup: () => Promise<void>;
  let auth: ReturnType<typeof createAuth>;

  // Two users for testing isolation
  let userA: { locals: Partial<App.Locals>; userId: string };
  let userB: { locals: Partial<App.Locals>; userId: string };

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
    auth = createAuth(db);

    // Create two authenticated users
    userA = await createAuthenticatedUser(db, auth, 'usera@example.com', 'User A');
    userB = await createAuthenticatedUser(db, auth, 'userb@example.com', 'User B');
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('GET /api/projects - Project List Isolation', () => {
    it('only returns projects owned by the authenticated user', async () => {
      // Create project owned by User A
      // Note: This test will fail until we add ownerId to schema and update seedProject
      const projectA = await seedProject(db, { name: 'project-a', ownerId: userA.userId });

      // Create project owned by User B (not accessed directly, just verifying isolation)
      await seedProject(db, { name: 'project-b', ownerId: userB.userId });

      // User A requests project list
      const request = new Request('http://localhost/api/projects', { method: 'GET' });
      const event = createRequestEvent(request, db, {}, userA.locals);
      const response = await GET_PROJECTS(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      // User A should only see their own project
      expect(body.projects).toHaveLength(1);
      expect(body.projects[0].id).toBe(projectA.id);
      expect(body.projects[0].name).toBe('project-a');
    });

    it('returns empty array when user has no projects', async () => {
      // Create project owned by User B only
      await seedProject(db, { name: 'project-b', ownerId: userB.userId });

      // User A requests project list
      const request = new Request('http://localhost/api/projects', { method: 'GET' });
      const event = createRequestEvent(request, db, {}, userA.locals);
      const response = await GET_PROJECTS(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      // User A should see no projects
      expect(body.projects).toHaveLength(0);
    });
  });

  describe('POST /api/projects - Project Creation Ownership', () => {
    it('sets ownerId to the authenticated user when creating a project', async () => {
      const request = new Request('http://localhost/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'my-new-project' }),
      });

      const event = createRequestEvent(request, db, {}, userA.locals);
      const response = await POST_PROJECTS(event as never);

      expect(response.status).toBe(201);
      const body = await response.json();

      // Verify ownerId is set in database
      const [dbProject] = await db.select().from(project).where(eq(project.id, body.id));
      expect(dbProject).toBeDefined();
      expect(dbProject!.ownerId).toBe(userA.userId);
    });
  });

  describe('GET /api/projects/[id] - Project Detail Authorization', () => {
    it("returns 404 when accessing another user's project", async () => {
      // Create project owned by User B
      const projectB = await seedProject(db, { name: 'project-b', ownerId: userB.userId });

      // User A tries to access User B's project
      const request = new Request(`http://localhost/api/projects/${projectB.id}`, {
        method: 'GET',
      });

      const event = createRequestEvent(request, db, { id: projectB.id }, userA.locals);
      const response = await GET_PROJECT(event as never);

      // Should return 404 to hide existence
      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body).toHaveProperty('error', 'not_found');
    });

    it('returns project when accessing own project', async () => {
      // Create project owned by User A
      const projectA = await seedProject(db, { name: 'project-a', ownerId: userA.userId });

      // User A accesses their own project
      const request = new Request(`http://localhost/api/projects/${projectA.id}`, {
        method: 'GET',
      });

      const event = createRequestEvent(request, db, { id: projectA.id }, userA.locals);
      const response = await GET_PROJECT(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.id).toBe(projectA.id);
    });
  });

  describe('PATCH /api/projects/[id] - Project Update Authorization', () => {
    it("returns 404 when updating another user's project", async () => {
      // Create project owned by User B
      const projectB = await seedProject(db, { name: 'project-b', ownerId: userB.userId });

      // User A tries to update User B's project
      const request = new Request(`http://localhost/api/projects/${projectB.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'hacked-name' }),
      });

      const event = createRequestEvent(request, db, { id: projectB.id }, userA.locals);
      const response = await PATCH(event as never);

      // Should return 404 to hide existence
      expect(response.status).toBe(404);

      // Verify project was NOT modified
      const [dbProject] = await db.select().from(project).where(eq(project.id, projectB.id));
      expect(dbProject!.name).toBe('project-b');
    });

    it('allows updating own project', async () => {
      // Create project owned by User A
      const projectA = await seedProject(db, { name: 'project-a', ownerId: userA.userId });

      // User A updates their own project
      const request = new Request(`http://localhost/api/projects/${projectA.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'updated-name' }),
      });

      const event = createRequestEvent(request, db, { id: projectA.id }, userA.locals);
      const response = await PATCH(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.name).toBe('updated-name');
    });
  });

  describe('DELETE /api/projects/[id] - Project Deletion Authorization', () => {
    it("returns 404 when deleting another user's project", async () => {
      // Create project owned by User B
      const projectB = await seedProject(db, { name: 'project-b', ownerId: userB.userId });

      // User A tries to delete User B's project
      const request = new Request(`http://localhost/api/projects/${projectB.id}`, {
        method: 'DELETE',
      });

      const event = createRequestEvent(request, db, { id: projectB.id }, userA.locals);
      const response = await DELETE(event as never);

      // Should return 404 to hide existence
      expect(response.status).toBe(404);

      // Verify project was NOT deleted
      const [dbProject] = await db.select().from(project).where(eq(project.id, projectB.id));
      expect(dbProject).toBeDefined();
    });

    it('allows deleting own project', async () => {
      // Create project owned by User A
      const projectA = await seedProject(db, { name: 'project-a', ownerId: userA.userId });

      // User A deletes their own project
      const request = new Request(`http://localhost/api/projects/${projectA.id}`, {
        method: 'DELETE',
      });

      const event = createRequestEvent(request, db, { id: projectA.id }, userA.locals);
      const response = await DELETE(event as never);

      expect(response.status).toBe(200);

      // Verify project was deleted
      const projects = await db.select().from(project).where(eq(project.id, projectA.id));
      expect(projects).toHaveLength(0);
    });
  });

  describe('POST /api/projects/[id]/regenerate - API Key Regeneration Authorization', () => {
    it("returns 404 when regenerating another user's project API key", async () => {
      // Create project owned by User B
      const projectB = await seedProjectWithApiKey(db, {
        name: 'project-b',
        ownerId: userB.userId,
      });
      const originalApiKey = projectB.apiKey;

      // User A tries to regenerate User B's API key
      const request = new Request(`http://localhost/api/projects/${projectB.id}/regenerate`, {
        method: 'POST',
      });

      const event = createRequestEvent(request, db, { id: projectB.id }, userA.locals);
      const response = await POST_REGENERATE(event as never);

      // Should return 404 to hide existence
      expect(response.status).toBe(404);

      // Verify API key was NOT changed
      const [dbProject] = await db.select().from(project).where(eq(project.id, projectB.id));
      expect(dbProject!.apiKeyHash).toBe(hashApiKey(originalApiKey));
    });

    it('allows regenerating own project API key', async () => {
      // Create project owned by User A
      const projectA = await seedProjectWithApiKey(db, {
        name: 'project-a',
        ownerId: userA.userId,
      });
      const originalApiKey = projectA.apiKey;

      // User A regenerates their own API key
      const request = new Request(`http://localhost/api/projects/${projectA.id}/regenerate`, {
        method: 'POST',
      });

      const event = createRequestEvent(request, db, { id: projectA.id }, userA.locals);
      const response = await POST_REGENERATE(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.apiKey).not.toBe(originalApiKey);
    });
  });

  describe('GET /api/projects/[id]/logs - Log Query Authorization', () => {
    it("returns 404 when querying logs from another user's project", async () => {
      // Create project owned by User B
      const projectB = await seedProject(db, { name: 'project-b', ownerId: userB.userId });

      // User A tries to query User B's logs
      const request = new Request(`http://localhost/api/projects/${projectB.id}/logs`, {
        method: 'GET',
      });

      const event = createRequestEvent(request, db, { id: projectB.id }, userA.locals);
      const response = await GET_LOGS(event as never);

      // Should return 404 to hide existence
      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/projects/[id]/stats - Stats Authorization', () => {
    it("returns 404 when querying stats from another user's project", async () => {
      // Create project owned by User B
      const projectB = await seedProject(db, { name: 'project-b', ownerId: userB.userId });

      // User A tries to query User B's stats
      const request = new Request(`http://localhost/api/projects/${projectB.id}/stats`, {
        method: 'GET',
      });

      const event = createRequestEvent(request, db, { id: projectB.id }, userA.locals);
      const response = await GET_STATS(event as never);

      // Should return 404 to hide existence
      expect(response.status).toBe(404);
    });
  });
});
