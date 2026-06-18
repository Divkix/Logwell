import type { HttpError } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createAuth } from "$lib/server/auth";
import type * as schema from "$lib/server/db/schema";
import { project } from "$lib/server/db/schema";
import { setupTestDatabase } from "$lib/server/db/test-db";
import { getSession } from "$lib/server/session";
import { GET, PATCH } from "../../../../src/routes/api/projects/[id]/+server";
import { seedProject } from "../../../fixtures/db";

/**
 * Helper to create a mock SvelteKit RequestEvent for session-authenticated routes.
 * Adds a same-origin Origin header to state-changing requests so they pass CSRF checks.
 */
function createRequestEvent(
  request: Request,
  db: PgliteDatabase<typeof schema>,
  locals: Partial<App.Locals> = {},
  params: Record<string, string> = {},
) {
  const safeMethod = ["GET", "HEAD", "OPTIONS"].includes(request.method);
  const hasOrigin = request.headers.has("Origin");
  const effectiveRequest =
    !safeMethod && !hasOrigin
      ? new Request(request, {
          headers: { ...Object.fromEntries(request.headers), Origin: new URL(request.url).origin },
        })
      : request;
  return {
    request: effectiveRequest,
    locals: { db, ...locals },
    params,
    url: new URL(request.url),
    platform: undefined,
    route: { id: "/api/projects/[id]" },
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
    expect.fail("Expected HTTP error to be thrown");
  } catch (error) {
    const httpError = error as HttpError;
    expect(httpError.status).toBe(expectedStatus);
    if (expectedBody) {
      expect(httpError.body).toEqual(expectedBody);
    }
  }
}

describe("PATCH /api/projects/[id] with retentionDays", () => {
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

    // Create authenticated user
    const signUpResult = await auth.api.signUpEmail({
      body: {
        email: "test@example.com",
        password: "SecureP@ssw0rd123",
        name: "Test User",
      },
    });

    const mockRequest = new Request("http://localhost:5173", {
      headers: {
        cookie: `better-auth.session_token=${signUpResult.token}`,
      },
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

  describe("Authentication", () => {
    it("returns 401 for unauthenticated request", async () => {
      const testProject = await seedProject(db, { ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ retentionDays: 30 }),
      });

      const event = createRequestEvent(request, db, {}, { id: testProject.id });
      await expectHttpError(PATCH(event as never), 401, { message: "Unauthorized" });
    });
  });

  describe("retentionDays updates", () => {
    it("should update retentionDays to null", async () => {
      // Seed project with existing retentionDays value
      const testProject = await seedProject(db, { retentionDays: 30, ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ retentionDays: null }),
      });

      const event = createRequestEvent(request, db, authenticatedLocals, { id: testProject.id });
      const response = await PATCH(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.retentionDays).toBeNull();

      // Verify in database
      const [dbProject] = await db.select().from(project).where(eq(project.id, testProject.id));
      expect(dbProject!.retentionDays).toBeNull();
    });

    it("should update retentionDays to 0 (never delete)", async () => {
      const testProject = await seedProject(db, { retentionDays: 30, ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ retentionDays: 0 }),
      });

      const event = createRequestEvent(request, db, authenticatedLocals, { id: testProject.id });
      const response = await PATCH(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.retentionDays).toBe(0);

      // Verify in database
      const [dbProject] = await db.select().from(project).where(eq(project.id, testProject.id));
      expect(dbProject!.retentionDays).toBe(0);
    });

    it("should update retentionDays to positive value", async () => {
      const testProject = await seedProject(db, { ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ retentionDays: 90 }),
      });

      const event = createRequestEvent(request, db, authenticatedLocals, { id: testProject.id });
      const response = await PATCH(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.retentionDays).toBe(90);

      // Verify in database
      const [dbProject] = await db.select().from(project).where(eq(project.id, testProject.id));
      expect(dbProject!.retentionDays).toBe(90);
    });

    it("should reject invalid retentionDays (negative)", async () => {
      const testProject = await seedProject(db, { ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ retentionDays: -1 }),
      });

      const event = createRequestEvent(request, db, authenticatedLocals, { id: testProject.id });
      const response = await PATCH(event as never);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.code).toBe("validation_error");
    });

    it("should reject invalid retentionDays (exceeds max)", async () => {
      const testProject = await seedProject(db, { ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ retentionDays: 3651 }),
      });

      const event = createRequestEvent(request, db, authenticatedLocals, { id: testProject.id });
      const response = await PATCH(event as never);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.code).toBe("validation_error");
    });

    it("should reject invalid retentionDays (non-integer)", async () => {
      const testProject = await seedProject(db, { ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ retentionDays: 30.5 }),
      });

      const event = createRequestEvent(request, db, authenticatedLocals, { id: testProject.id });
      const response = await PATCH(event as never);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.code).toBe("validation_error");
    });

    it("should not change retentionDays when not provided", async () => {
      const testProject = await seedProject(db, { retentionDays: 45, ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "new-name" }),
      });

      const event = createRequestEvent(request, db, authenticatedLocals, { id: testProject.id });
      const response = await PATCH(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.retentionDays).toBe(45);
      expect(body.name).toBe("new-name");

      // Verify in database
      const [dbProject] = await db.select().from(project).where(eq(project.id, testProject.id));
      expect(dbProject!.retentionDays).toBe(45);
      expect(dbProject!.name).toBe("new-name");
    });

    it("should update both name and retentionDays together", async () => {
      const testProject = await seedProject(db, { retentionDays: 30, ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "updated-project", retentionDays: 60 }),
      });

      const event = createRequestEvent(request, db, authenticatedLocals, { id: testProject.id });
      const response = await PATCH(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.name).toBe("updated-project");
      expect(body.retentionDays).toBe(60);

      // Verify in database
      const [dbProject] = await db.select().from(project).where(eq(project.id, testProject.id));
      expect(dbProject!.name).toBe("updated-project");
      expect(dbProject!.retentionDays).toBe(60);
    });
  });
});

describe("GET /api/projects/[id] retentionDays", () => {
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

    // Create authenticated user
    const signUpResult = await auth.api.signUpEmail({
      body: {
        email: "test@example.com",
        password: "SecureP@ssw0rd123",
        name: "Test User",
      },
    });

    const mockRequest = new Request("http://localhost:5173", {
      headers: {
        cookie: `better-auth.session_token=${signUpResult.token}`,
      },
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

  describe("Authentication", () => {
    it("returns 401 for unauthenticated request", async () => {
      const testProject = await seedProject(db, { ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: "GET",
      });

      const event = createRequestEvent(request, db, {}, { id: testProject.id });
      await expectHttpError(GET(event as never), 401, { message: "Unauthorized" });
    });
  });

  describe("retentionDays retrieval", () => {
    it("should include retentionDays in response", async () => {
      const testProject = await seedProject(db, { retentionDays: 30, ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: "GET",
      });

      const event = createRequestEvent(request, db, authenticatedLocals, { id: testProject.id });
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty("retentionDays");
      expect(body.retentionDays).toBe(30);
    });

    it("should return null when retentionDays not set", async () => {
      const testProject = await seedProject(db, { retentionDays: null, ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: "GET",
      });

      const event = createRequestEvent(request, db, authenticatedLocals, { id: testProject.id });
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty("retentionDays");
      expect(body.retentionDays).toBeNull();
    });

    it("should return 0 when set to never delete", async () => {
      const testProject = await seedProject(db, { retentionDays: 0, ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: "GET",
      });

      const event = createRequestEvent(request, db, authenticatedLocals, { id: testProject.id });
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty("retentionDays");
      expect(body.retentionDays).toBe(0);
    });

    it("should return positive value when set", async () => {
      const testProject = await seedProject(db, { retentionDays: 365, ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: "GET",
      });

      const event = createRequestEvent(request, db, authenticatedLocals, { id: testProject.id });
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty("retentionDays");
      expect(body.retentionDays).toBe(365);
    });
  });
});
