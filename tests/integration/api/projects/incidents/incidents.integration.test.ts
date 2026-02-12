import type { Redirect } from '@sveltejs/kit';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuth } from '$lib/server/auth';
import type * as schema from '$lib/server/db/schema';
import { incident } from '$lib/server/db/schema';
import { setupTestDatabase } from '$lib/server/db/test-db';
import { getSession } from '$lib/server/session';
import { GET as GET_DETAIL } from '../../../../../src/routes/api/projects/[id]/incidents/[incidentId]/+server';
import { GET as GET_TIMELINE } from '../../../../../src/routes/api/projects/[id]/incidents/[incidentId]/timeline/+server';
import { GET as GET_LIST } from '../../../../../src/routes/api/projects/[id]/incidents/+server';
import { seedLog, seedProject } from '../../../../fixtures/db';

function createRequestEvent(
  request: Request,
  db: PgliteDatabase<typeof schema>,
  params: Record<string, string>,
  locals: Partial<App.Locals> = {},
  routeId = '/api/projects/[id]/incidents',
) {
  return {
    request,
    locals: { db, ...locals },
    params,
    url: new URL(request.url),
    platform: undefined,
    route: { id: routeId },
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

describe('Incident APIs', () => {
  let db: PgliteDatabase<typeof schema>;
  let cleanup: () => Promise<void>;
  let auth: ReturnType<typeof createAuth>;
  let userId: string;
  let authenticatedLocals: Partial<App.Locals>;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
    auth = createAuth(db);

    const signUpResult = await auth.api.signUpEmail({
      body: {
        email: 'incident-test@example.com',
        password: 'SecureP@ssw0rd123',
        name: 'Incident User',
      },
    });

    const mockRequest = new Request('http://localhost:5173', {
      headers: { cookie: `better-auth.session_token=${signUpResult.token}` },
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

  it('requires authentication for incidents list', async () => {
    const project = await seedProject(db, { ownerId: userId });
    const request = new Request(`http://localhost/api/projects/${project.id}/incidents`);
    const event = createRequestEvent(request, db, { id: project.id });

    await expectRedirect(GET_LIST(event as never), 303, '/login');
  });

  it('lists only open incidents by default', async () => {
    const project = await seedProject(db, { ownerId: userId });
    const now = Date.now();

    await db.insert(incident).values([
      {
        id: 'inc-open',
        projectId: project.id,
        fingerprint: 'fp-open',
        title: 'Open incident',
        normalizedMessage: 'open incident',
        serviceName: 'api',
        sourceFile: 'src/a.ts',
        lineNumber: 10,
        highestLevel: 'error',
        firstSeen: new Date(now - 10 * 60 * 1000),
        lastSeen: new Date(now - 5 * 60 * 1000),
        totalEvents: 4,
        reopenCount: 0,
      },
      {
        id: 'inc-resolved',
        projectId: project.id,
        fingerprint: 'fp-resolved',
        title: 'Resolved incident',
        normalizedMessage: 'resolved incident',
        serviceName: 'api',
        sourceFile: 'src/b.ts',
        lineNumber: 20,
        highestLevel: 'error',
        firstSeen: new Date(now - 3 * 60 * 60 * 1000),
        lastSeen: new Date(now - 2 * 60 * 60 * 1000),
        totalEvents: 2,
        reopenCount: 1,
      },
    ]);

    const request = new Request(`http://localhost/api/projects/${project.id}/incidents`);
    const event = createRequestEvent(request, db, { id: project.id }, authenticatedLocals);
    const response = await GET_LIST(event as never);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.incidents).toHaveLength(1);
    expect(body.incidents[0].id).toBe('inc-open');
    expect(body.incidents[0].status).toBe('open');
  });

  it('returns detail with source candidates and correlations', async () => {
    const project = await seedProject(db, { ownerId: userId });
    const [createdIncident] = await db
      .insert(incident)
      .values({
        id: 'inc-detail',
        projectId: project.id,
        fingerprint: 'fp-detail',
        title: 'DB timeout',
        normalizedMessage: 'db timeout {num}',
        serviceName: 'api',
        sourceFile: 'src/db.ts',
        lineNumber: 42,
        highestLevel: 'error',
        firstSeen: new Date(Date.now() - 20 * 60 * 1000),
        lastSeen: new Date(Date.now() - 5 * 60 * 1000),
        totalEvents: 3,
        reopenCount: 0,
      })
      .returning();

    await seedLog(db, project.id, {
      incidentId: createdIncident.id,
      fingerprint: createdIncident.fingerprint,
      level: 'error',
      message: 'DB timeout',
      sourceFile: 'src/db.ts',
      lineNumber: 42,
      requestId: 'req-1',
      traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    await seedLog(db, project.id, {
      incidentId: createdIncident.id,
      fingerprint: createdIncident.fingerprint,
      level: 'error',
      message: 'DB timeout',
      sourceFile: 'src/db.ts',
      lineNumber: 42,
      requestId: 'req-1',
      traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    await seedLog(db, project.id, {
      incidentId: createdIncident.id,
      fingerprint: createdIncident.fingerprint,
      level: 'error',
      message: 'DB timeout',
      sourceFile: 'src/worker.ts',
      lineNumber: 9,
      requestId: 'req-2',
      traceId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    });

    const request = new Request(`http://localhost/api/projects/${project.id}/incidents/${createdIncident.id}`);
    const event = createRequestEvent(
      request,
      db,
      { id: project.id, incidentId: createdIncident.id },
      authenticatedLocals,
      '/api/projects/[id]/incidents/[incidentId]',
    );
    const response = await GET_DETAIL(event as never);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.id).toBe(createdIncident.id);
    expect(body.rootCauseCandidates[0].sourceFile).toBe('src/db.ts');
    expect(body.correlations.topRequestIds[0]).toEqual({ requestId: 'req-1', count: 2 });
    expect(body.correlations.topTraceIds[0]).toEqual({
      traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      count: 2,
    });
  });

  it('returns timeline buckets with peak data', async () => {
    const project = await seedProject(db, { ownerId: userId });
    const [createdIncident] = await db
      .insert(incident)
      .values({
        id: 'inc-timeline',
        projectId: project.id,
        fingerprint: 'fp-timeline',
        title: 'Timeline incident',
        normalizedMessage: 'timeline incident',
        serviceName: 'api',
        sourceFile: 'src/timeline.ts',
        lineNumber: 1,
        highestLevel: 'error',
        firstSeen: new Date(Date.now() - 50 * 60 * 1000),
        lastSeen: new Date(Date.now() - 5 * 60 * 1000),
        totalEvents: 0,
        reopenCount: 0,
      })
      .returning();

    await seedLog(db, project.id, {
      incidentId: createdIncident.id,
      level: 'error',
      message: 'err1',
      timestamp: new Date(Date.now() - 20 * 60 * 1000),
    });
    await seedLog(db, project.id, {
      incidentId: createdIncident.id,
      level: 'error',
      message: 'err2',
      timestamp: new Date(Date.now() - 20 * 60 * 1000),
    });
    await seedLog(db, project.id, {
      incidentId: createdIncident.id,
      level: 'error',
      message: 'err3',
      timestamp: new Date(Date.now() - 10 * 60 * 1000),
    });

    const request = new Request(
      `http://localhost/api/projects/${project.id}/incidents/${createdIncident.id}/timeline?range=1h`,
    );
    const event = createRequestEvent(
      request,
      db,
      { id: project.id, incidentId: createdIncident.id },
      authenticatedLocals,
      '/api/projects/[id]/incidents/[incidentId]/timeline',
    );
    const response = await GET_TIMELINE(event as never);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.range).toBe('1h');
    expect(body.buckets.length).toBeGreaterThan(0);
    expect(body.peakBucket).not.toBeNull();
  });

  it("returns 404 when user accesses another user's incident", async () => {
    const otherUser = await auth.api.signUpEmail({
      body: {
        email: 'other-user@example.com',
        password: 'SecureP@ssw0rd123',
        name: 'Other User',
      },
    });
    const otherRequest = new Request('http://localhost:5173', {
      headers: { cookie: `better-auth.session_token=${otherUser.token}` },
    });
    const otherSession = await getSession(otherRequest.headers, db);
    if (!otherSession) throw new Error('Missing other session');

    const otherProject = await seedProject(db, { ownerId: otherSession.user.id });
    const [otherIncident] = await db
      .insert(incident)
      .values({
        id: 'inc-private',
        projectId: otherProject.id,
        fingerprint: 'fp-private',
        title: 'Private incident',
        normalizedMessage: 'private',
        serviceName: null,
        sourceFile: null,
        lineNumber: null,
        highestLevel: 'error',
        firstSeen: new Date(),
        lastSeen: new Date(),
        totalEvents: 1,
        reopenCount: 0,
      })
      .returning();

    const request = new Request(`http://localhost/api/projects/${otherProject.id}/incidents/${otherIncident.id}`);
    const event = createRequestEvent(
      request,
      db,
      { id: otherProject.id, incidentId: otherIncident.id },
      authenticatedLocals,
      '/api/projects/[id]/incidents/[incidentId]',
    );
    const response = await GET_DETAIL(event as never);
    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body).toHaveProperty('error', 'not_found');
  });
});
