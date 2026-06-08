import type { PgliteDatabase } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createAuth } from "$lib/server/auth";
import type * as schema from "$lib/server/db/schema";
import { incident } from "$lib/server/db/schema";
import { setupTestDatabase } from "$lib/server/db/test-db";
import { getSession } from "$lib/server/session";
import { GET as GET_DETAIL } from "../../../../../src/routes/api/projects/[id]/incidents/[incidentId]/+server";
import { seedProject } from "../../../../fixtures/db";

function createRequestEvent(
  request: Request,
  db: PgliteDatabase<typeof schema>,
  params: Record<string, string>,
  locals: Partial<App.Locals> = {},
) {
  return {
    request,
    locals: { db, ...locals },
    params,
    url: new URL(request.url),
    platform: undefined,
    route: { id: "/api/projects/[id]/incidents/[incidentId]" },
    isDataRequest: false,
    isSubRequest: false,
    isRemoteRequest: false,
    tracing: null,
    cookies: {
      get: () => undefined,
      getAll: () => [],
      set: () => {},
      delete: () => {},
      serialize: () => "",
    },
    fetch: globalThis.fetch,
    getClientAddress: () => "127.0.0.1",
    setHeaders: () => {},
  } as unknown;
}

describe("GET /api/projects/[id]/incidents/[incidentId]", () => {
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
        email: "incident-detail@example.com",
        password: "SecureP@ssw0rd123",
        name: "Detail User",
      },
    });

    const mockRequest = new Request("http://localhost:5173", {
      headers: { cookie: `better-auth.session_token=${signUpResult.token}` },
    });
    const sessionData = await getSession(mockRequest.headers, db);
    if (!sessionData) throw new Error("Session data should not be null");

    userId = sessionData.user.id;
    authenticatedLocals = {
      user: sessionData.user,
      session: sessionData.session,
    };
  });

  afterEach(async () => {
    await cleanup();
  });

  it("returns 200 with incident data for existing incident", async () => {
    const testProject = await seedProject(db, { ownerId: userId });
    const [createdIncident] = await db
      .insert(incident)
      .values({
        id: "inc-exists",
        projectId: testProject.id,
        fingerprint: "fp-exists",
        title: "Test incident",
        normalizedMessage: "test incident",
        serviceName: "api",
        sourceFile: "src/test.ts",
        lineNumber: 1,
        highestLevel: "error",
        firstSeen: new Date(Date.now() - 10 * 60 * 1000),
        lastSeen: new Date(Date.now() - 5 * 60 * 1000),
        totalEvents: 1,
      })
      .returning();

    const request = new Request(
      `http://localhost/api/projects/${testProject.id}/incidents/${createdIncident!.id}`,
    );
    const event = createRequestEvent(
      request,
      db,
      { id: testProject.id, incidentId: createdIncident!.id },
      authenticatedLocals,
    );
    const response = await GET_DETAIL(event as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(createdIncident!.id);
    expect(body.title).toBe("Test incident");
    expect(body).toHaveProperty("rootCauseCandidates");
    expect(body).toHaveProperty("correlations");
  });

  it("returns 404 for non-existent incident", async () => {
    const testProject = await seedProject(db, { ownerId: userId });

    const request = new Request(
      `http://localhost/api/projects/${testProject.id}/incidents/nonexistent-id`,
    );
    const event = createRequestEvent(
      request,
      db,
      { id: testProject.id, incidentId: "nonexistent-id" },
      authenticatedLocals,
    );
    const response = await GET_DETAIL(event as never);

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toHaveProperty("error", "not_found");
  });

  it("returns 404 for incident belonging to a different project", async () => {
    const ownerProject = await seedProject(db, { ownerId: userId });

    // Create a second user and their project
    const otherUser = await auth.api.signUpEmail({
      body: {
        email: "other-detail@example.com",
        password: "SecureP@ssw0rd123",
        name: "Other",
      },
    });
    const otherRequest = new Request("http://localhost:5173", {
      headers: { cookie: `better-auth.session_token=${otherUser.token}` },
    });
    const otherSession = await getSession(otherRequest.headers, db);
    if (!otherSession) throw new Error("Missing other session");

    const otherProject = await seedProject(db, { ownerId: otherSession.user.id });
    const [otherIncident] = await db
      .insert(incident)
      .values({
        id: "inc-other-proj",
        projectId: otherProject.id,
        fingerprint: "fp-other",
        title: "Other project incident",
        normalizedMessage: "other",
        serviceName: null,
        sourceFile: null,
        lineNumber: null,
        highestLevel: "error",
        firstSeen: new Date(),
        lastSeen: new Date(),
        totalEvents: 1,
      })
      .returning();

    // Query the incident using our user's project ID but incident from other project
    const request = new Request(
      `http://localhost/api/projects/${ownerProject.id}/incidents/${otherIncident!.id}`,
    );
    const event = createRequestEvent(
      request,
      db,
      { id: ownerProject.id, incidentId: otherIncident!.id },
      authenticatedLocals,
    );
    const response = await GET_DETAIL(event as never);

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toHaveProperty("error", "not_found");
  });

  it("returns 401 for unauthenticated request", async () => {
    const testProject = await seedProject(db, { ownerId: userId });
    const [createdIncident] = await db
      .insert(incident)
      .values({
        id: "inc-unauth",
        projectId: testProject.id,
        fingerprint: "fp-unauth",
        title: "Unauth incident",
        normalizedMessage: "unauth",
        serviceName: null,
        sourceFile: null,
        lineNumber: null,
        highestLevel: "error",
        firstSeen: new Date(),
        lastSeen: new Date(),
        totalEvents: 1,
      })
      .returning();

    const request = new Request(
      `http://localhost/api/projects/${testProject.id}/incidents/${createdIncident!.id}`,
    );
    const event = createRequestEvent(request, db, {
      id: testProject.id,
      incidentId: createdIncident!.id,
    });

    try {
      const response = await GET_DETAIL(event as never);
      // Some implementations return 401 response instead of throwing
      expect(response.status).toBe(401);
    } catch (error) {
      const httpError = error as { status: number };
      expect(httpError.status).toBe(401);
    }
  });
});
