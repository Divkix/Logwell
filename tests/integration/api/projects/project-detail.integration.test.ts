import type { HttpError } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createAuth } from "$lib/server/auth";
import type * as schema from "$lib/server/db/schema";
import { log, project } from "$lib/server/db/schema";
import { setupTestDatabase } from "$lib/server/db/test-db";
import { getSession } from "$lib/server/session";
import { clearApiKeyCache, hashApiKey, validateApiKey } from "$lib/server/utils/api-key";
import { DELETE, GET } from "../../../../src/routes/api/projects/[id]/+server";
import { POST as POST_REGENERATE } from "../../../../src/routes/api/projects/[id]/regenerate/+server";
import { POST as POST_INGEST } from "../../../../src/routes/v1/ingest/+server";
import { seedLogs, seedProject, seedProjectWithApiKey } from "../../../fixtures/db";

/**
 * Helper to create a mock SvelteKit RequestEvent for [id] routes.
 * Adds a same-origin Origin header to state-changing requests so they pass CSRF checks.
 */
function createRequestEvent(
  request: Request,
  db: PgliteDatabase<typeof schema>,
  params: { id: string },
  locals: Partial<App.Locals> = {},
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

function createIngestRequestEvent(request: Request, db: PgliteDatabase<typeof schema>) {
  return {
    request,
    locals: { db },
    params: {},
    url: new URL(request.url),
    platform: undefined,
    route: { id: "/v1/ingest" },
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

describe("GET /api/projects/[id]", () => {
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

      const event = createRequestEvent(request, db, { id: testProject.id });
      await expectHttpError(GET(event as never), 401, { message: "Unauthorized" });
    });
  });

  describe("Project Detail", () => {
    it("returns project with stats", async () => {
      const testProject = await seedProject(db, { name: "my-test-project", ownerId: userId });
      // Add 10 logs with various levels
      await seedLogs(db, testProject.id, 3, { level: "info" });
      await seedLogs(db, testProject.id, 2, { level: "error" });
      await seedLogs(db, testProject.id, 5, { level: "debug" });

      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: "GET",
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      // Basic project fields
      expect(body).toHaveProperty("id", testProject.id);
      expect(body).toHaveProperty("name", "my-test-project");
      expect(body).not.toHaveProperty("apiKey");
      expect(body).toHaveProperty("createdAt");
      expect(body).toHaveProperty("updatedAt");

      // Stats
      expect(body).toHaveProperty("stats");
      expect(body.stats).toHaveProperty("totalLogs", 10);
      expect(body.stats).toHaveProperty("levelCounts");
      expect(body.stats.levelCounts).toHaveProperty("info", 3);
      expect(body.stats.levelCounts).toHaveProperty("error", 2);
      expect(body.stats.levelCounts).toHaveProperty("debug", 5);
    });

    it("returns 404 for non-existent project", async () => {
      const request = new Request("http://localhost/api/projects/non-existent-id", {
        method: "GET",
      });

      const event = createRequestEvent(request, db, { id: "non-existent-id" }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body).toHaveProperty("error", "not_found");
    });

    it("returns empty level counts when project has no logs", async () => {
      const testProject = await seedProject(db, { ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: "GET",
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.stats.totalLogs).toBe(0);
    });
  });
});

describe("DELETE /api/projects/[id]", () => {
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
        method: "DELETE",
      });

      const event = createRequestEvent(request, db, { id: testProject.id });
      await expectHttpError(DELETE(event as never), 401, { message: "Unauthorized" });
    });
  });

  describe("Project Deletion", () => {
    it("removes project and logs", async () => {
      const testProject = await seedProject(db, { ownerId: userId });
      await seedLogs(db, testProject.id, 5);

      // Verify logs exist before deletion
      const logsBefore = await db.select().from(log).where(eq(log.projectId, testProject.id));
      expect(logsBefore).toHaveLength(5);

      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: "DELETE",
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await DELETE(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty("success", true);
      expect(body).toHaveProperty("id", testProject.id);

      // Verify project was deleted
      const projectsAfter = await db.select().from(project).where(eq(project.id, testProject.id));
      expect(projectsAfter).toHaveLength(0);

      // Verify logs were cascade deleted
      const logsAfter = await db.select().from(log).where(eq(log.projectId, testProject.id));
      expect(logsAfter).toHaveLength(0);
    });

    it("returns 404 for non-existent project", async () => {
      const request = new Request("http://localhost/api/projects/non-existent-id", {
        method: "DELETE",
      });

      const event = createRequestEvent(request, db, { id: "non-existent-id" }, authenticatedLocals);
      const response = await DELETE(event as never);

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body).toHaveProperty("error", "not_found");
    });

    it("invalidates API key cache on deletion", async () => {
      const testProject = await seedProjectWithApiKey(db, { ownerId: userId });

      // Validate API key to add to cache
      const apiKeyRequest = new Request("http://localhost", {
        headers: {
          Authorization: `Bearer ${testProject.apiKey}`,
        },
      });
      await validateApiKey(apiKeyRequest, db);

      // Delete project
      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: "DELETE",
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      await DELETE(event as never);

      // Verify API key is no longer valid (cache should be invalidated)
      await expect(validateApiKey(apiKeyRequest, db)).rejects.toThrow("Invalid API key");
    });

    it("prevents ingestion with deleted project API key", async () => {
      const testProject = await seedProjectWithApiKey(db, { ownerId: userId });

      // Populate cache by validating the API key
      const apiKeyRequest = new Request("http://localhost", {
        headers: {
          Authorization: `Bearer ${testProject.apiKey}`,
        },
      });
      await validateApiKey(apiKeyRequest, db);

      // Delete project
      const deleteRequest = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: "DELETE",
      });
      const deleteEvent = createRequestEvent(
        deleteRequest,
        db,
        { id: testProject.id },
        authenticatedLocals,
      );
      const deleteResponse = await DELETE(deleteEvent as never);
      expect(deleteResponse.status).toBe(200);

      // Attempt to ingest with the now-deleted project's API key
      const ingestRequest = new Request("http://localhost/v1/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${testProject.apiKey}`,
        },
        body: JSON.stringify({ level: "info", message: "test" }),
      });

      const ingestEvent = createIngestRequestEvent(ingestRequest, db);
      const ingestResponse = await POST_INGEST(ingestEvent as never);

      // Should return 401, not 500 from FK violation
      expect(ingestResponse.status).toBe(401);
      const body = await ingestResponse.json();
      expect(body.error).toBe("unauthorized");
    });
  });
});

describe("POST /api/projects/[id]/regenerate", () => {
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
      const request = new Request(`http://localhost/api/projects/${testProject.id}/regenerate`, {
        method: "POST",
      });

      const event = createRequestEvent(request, db, { id: testProject.id });
      await expectHttpError(POST_REGENERATE(event as never), 401, { message: "Unauthorized" });
    });
  });

  describe("API Key Regeneration", () => {
    it("returns new API key", async () => {
      const testProject = await seedProjectWithApiKey(db, { ownerId: userId });
      const oldApiKey = testProject.apiKey;

      const request = new Request(`http://localhost/api/projects/${testProject.id}/regenerate`, {
        method: "POST",
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await POST_REGENERATE(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toHaveProperty("apiKey");
      expect(body.apiKey).toMatch(/^lw_[A-Za-z0-9_-]{32}$/);
      expect(body.apiKey).not.toBe(oldApiKey);

      // Verify in database
      const [updatedProject] = await db
        .select()
        .from(project)
        .where(eq(project.id, testProject.id));
      expect(updatedProject!.apiKeyHash).toBe(hashApiKey(body.apiKey));
    });

    it("invalidates old API key", async () => {
      const testProject = await seedProjectWithApiKey(db, { ownerId: userId });
      const oldApiKey = testProject.apiKey;

      // Validate old API key to add to cache
      const oldKeyRequest = new Request("http://localhost", {
        headers: {
          Authorization: `Bearer ${oldApiKey}`,
        },
      });
      await validateApiKey(oldKeyRequest, db);

      // Regenerate API key
      const request = new Request(`http://localhost/api/projects/${testProject.id}/regenerate`, {
        method: "POST",
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await POST_REGENERATE(event as never);
      const body = await response.json();

      // Old key should no longer work
      await expect(validateApiKey(oldKeyRequest, db)).rejects.toThrow("Invalid API key");

      // New key should work
      const newKeyRequest = new Request("http://localhost", {
        headers: {
          Authorization: `Bearer ${body.apiKey}`,
        },
      });
      const projectId = await validateApiKey(newKeyRequest, db);
      expect(projectId).toBe(testProject.id);
    });

    it("returns 404 for non-existent project", async () => {
      const request = new Request("http://localhost/api/projects/non-existent-id/regenerate", {
        method: "POST",
      });

      const event = createRequestEvent(request, db, { id: "non-existent-id" }, authenticatedLocals);
      const response = await POST_REGENERATE(event as never);

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body).toHaveProperty("error", "not_found");
    });

    it("updates updatedAt timestamp", async () => {
      const testProject = await seedProject(db, { ownerId: userId });
      const originalUpdatedAt = testProject.updatedAt;

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      const request = new Request(`http://localhost/api/projects/${testProject.id}/regenerate`, {
        method: "POST",
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      await POST_REGENERATE(event as never);

      const [updatedProject] = await db
        .select()
        .from(project)
        .where(eq(project.id, testProject.id));
      expect(updatedProject!.updatedAt?.getTime()).toBeGreaterThan(
        originalUpdatedAt?.getTime() ?? 0,
      );
    });
  });
});
