import type { HttpError } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createAuth } from "$lib/server/auth";
import type * as schema from "$lib/server/db/schema";
import { project } from "$lib/server/db/schema";
import { setupTestDatabase } from "$lib/server/db/test-db";
import { getSession } from "$lib/server/session";
import { clearApiKeyCache } from "$lib/server/utils/api-key";
import { PATCH } from "../../../../src/routes/api/projects/[id]/+server";
import { seedProject } from "../../../fixtures/db";

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

describe("PATCH /api/projects/[id]", () => {
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
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "new-name" }),
      });

      const event = createRequestEvent(request, db, { id: testProject.id });
      await expectHttpError(PATCH(event as never), 401, { message: "Unauthorized" });
    });
  });

  describe("Project Rename", () => {
    it("updates project name successfully", async () => {
      const testProject = await seedProject(db, { name: "old-name", ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "new-name" }),
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await PATCH(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toHaveProperty("id", testProject.id);
      expect(body).toHaveProperty("name", "new-name");
      expect(body).not.toHaveProperty("apiKey");
      expect(body).toHaveProperty("updatedAt");

      // Verify in database
      const [updatedProject] = await db
        .select()
        .from(project)
        .where(eq(project.id, testProject.id));
      expect(updatedProject!.name).toBe("new-name");
    });

    it("rejects duplicate project name for same user", async () => {
      await seedProject(db, { name: "existing-project", ownerId: userId });
      const testProject = await seedProject(db, { name: "my-project", ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "existing-project" }),
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await PATCH(event as never);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toHaveProperty("code", "duplicate_name");
      expect(body).toHaveProperty("message", "A project with this name already exists");

      // Verify project name unchanged
      const [unchangedProject] = await db
        .select()
        .from(project)
        .where(eq(project.id, testProject.id));
      expect(unchangedProject!.name).toBe("my-project");
    });

    it("allows renaming to a name used by another user", async () => {
      // Create a project for the first user
      await seedProject(db, { name: "shared-project-name", ownerId: userId });

      // Create a second user with a project using the same name
      const signUpResult2 = await auth.api.signUpEmail({
        body: {
          email: "other@example.com",
          password: "SecureP@ssw0rd123",
          name: "Other User",
        },
      });

      const mockRequest2 = new Request("http://localhost:5173", {
        headers: {
          cookie: `better-auth.session_token=${signUpResult2.token}`,
        },
      });

      const sessionData2 = await getSession(mockRequest2.headers, db);
      if (!sessionData2) throw new Error("Session data should not be null");
      const otherUserId = sessionData2.user.id;

      const otherProject = await seedProject(db, {
        name: "other-project",
        ownerId: otherUserId,
      });

      const otherUserLocals = {
        user: sessionData2.user,
        session: sessionData2.session,
      };

      // Second user renames their project to the same name as first user's project
      const request = new Request(`http://localhost/api/projects/${otherProject.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "shared-project-name" }),
      });

      const event = createRequestEvent(request, db, { id: otherProject.id }, otherUserLocals);
      const response = await PATCH(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty("name", "shared-project-name");
    });

    it("validates name format - empty string", async () => {
      const testProject = await seedProject(db, { name: "my-project", ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "" }),
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await PATCH(event as never);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toHaveProperty("code", "validation_error");
      expect(body.message).toContain("cannot be empty");
    });

    it("validates name format - exceeds max length", async () => {
      const testProject = await seedProject(db, { name: "my-project", ownerId: userId });
      const longName = "a".repeat(51);

      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: longName }),
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await PATCH(event as never);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toHaveProperty("code", "validation_error");
      expect(body.message).toContain("cannot exceed 50 characters");
    });

    it("validates name format - invalid characters", async () => {
      const testProject = await seedProject(db, { name: "my-project", ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "invalid name!" }),
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await PATCH(event as never);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toHaveProperty("code", "validation_error");
      expect(body.message).toContain("alphanumeric");
    });

    it("returns 404 for non-existent project", async () => {
      const request = new Request("http://localhost/api/projects/non-existent-id", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "new-name" }),
      });

      const event = createRequestEvent(request, db, { id: "non-existent-id" }, authenticatedLocals);
      const response = await PATCH(event as never);

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body).toHaveProperty("error", "not_found");
    });

    it("updates updatedAt timestamp", async () => {
      const testProject = await seedProject(db, { name: "old-name", ownerId: userId });
      const originalUpdatedAt = testProject.updatedAt;

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "new-name" }),
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      await PATCH(event as never);

      const [updatedProject] = await db
        .select()
        .from(project)
        .where(eq(project.id, testProject.id));
      expect(updatedProject!.updatedAt?.getTime()).toBeGreaterThan(
        originalUpdatedAt?.getTime() ?? 0,
      );
    });

    it("allows renaming to same name (no-op)", async () => {
      const testProject = await seedProject(db, { name: "my-project", ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "my-project" }),
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await PATCH(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty("name", "my-project");
    });

    it("accepts empty body (no updates)", async () => {
      const testProject = await seedProject(db, { name: "my-project", ownerId: userId });
      const originalUpdatedAt = testProject.updatedAt;

      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await PATCH(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty("name", "my-project");
      expect(new Date(body.updatedAt).getTime()).toBe(originalUpdatedAt?.getTime());

      const [unchangedProject] = await db
        .select()
        .from(project)
        .where(eq(project.id, testProject.id));
      expect(unchangedProject!.updatedAt?.getTime()).toBe(originalUpdatedAt?.getTime());
    });

    it("returns 415 for non-JSON Content-Type", async () => {
      const testProject = await seedProject(db, { name: "my-project", ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "name=new-name",
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await PATCH(event as never);

      expect(response.status).toBe(415);
      const body = await response.json();
      expect(body).toHaveProperty("error", "unsupported_media_type");
      expect(body).toHaveProperty("message", "Content-Type must be application/json");
    });

    it("returns 400 for malformed JSON body", async () => {
      const testProject = await seedProject(db, { name: "my-project", ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: "{ invalid json",
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await PATCH(event as never);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toHaveProperty("error", "invalid_json");
      expect(body).toHaveProperty("message", "Invalid JSON body");
    });
  });
});
