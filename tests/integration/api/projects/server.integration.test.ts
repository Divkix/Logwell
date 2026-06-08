import type { HttpError } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createAuth } from "$lib/server/auth";
import type * as schema from "$lib/server/db/schema";
import { project } from "$lib/server/db/schema";
import { setupTestDatabase } from "$lib/server/db/test-db";
import { getSession } from "$lib/server/session";
import { hashApiKey } from "$lib/server/utils/api-key";
import { GET, POST } from "../../../../src/routes/api/projects/+server";
import { seedLogs, seedProject, seedProjects } from "../../../fixtures/db";

/**
 * Helper to create a mock SvelteKit RequestEvent for session-authenticated routes
 */
function createRequestEvent(
  request: Request,
  db: PgliteDatabase<typeof schema>,
  locals: Partial<App.Locals> = {},
) {
  return {
    request,
    locals: { db, ...locals },
    params: {},
    url: new URL(request.url),
    platform: undefined,
    route: { id: "/api/projects" },
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

describe("GET /api/projects", () => {
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
      const request = new Request("http://localhost/api/projects", {
        method: "GET",
      });

      const event = createRequestEvent(request, db);
      await expectHttpError(GET(event as never), 401, { message: "Unauthorized" });
    });
  });

  describe("Listing Projects", () => {
    it("returns empty array when no projects", async () => {
      const request = new Request("http://localhost/api/projects", {
        method: "GET",
      });

      const event = createRequestEvent(request, db, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty("projects");
      expect(body.projects).toEqual([]);
    });

    it("returns projects with log counts", async () => {
      // Create 2 projects
      const [project1, project2] = await seedProjects(db, 2, { ownerId: userId });

      // Add logs: 5 to project1, 0 to project2
      await seedLogs(db, project1!.id, 5);

      const request = new Request("http://localhost/api/projects", {
        method: "GET",
      });

      const event = createRequestEvent(request, db, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty("projects");
      expect(body.projects).toHaveLength(2);

      // Find projects by id
      const returnedProject1 = body.projects.find((p: { id: string }) => p.id === project1!.id);
      const returnedProject2 = body.projects.find((p: { id: string }) => p.id === project2!.id);

      expect(returnedProject1).toBeDefined();
      expect(returnedProject1.logCount).toBe(5);
      expect(returnedProject1.name).toBe(project1!.name);
      expect(returnedProject1).toHaveProperty("createdAt");
      expect(returnedProject1).toHaveProperty("updatedAt");

      expect(returnedProject2).toBeDefined();
      expect(returnedProject2.logCount).toBe(0);
    });

    it("returns projects ordered by createdAt descending", async () => {
      // Create projects with specific timestamps
      const oldProject = await seedProject(db, { name: "old-project", ownerId: userId });
      // Wait a bit to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));
      const newProject = await seedProject(db, { name: "new-project", ownerId: userId });

      const request = new Request("http://localhost/api/projects", {
        method: "GET",
      });

      const event = createRequestEvent(request, db, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      // Newest first
      expect(body.projects[0].id).toBe(newProject.id);
      expect(body.projects[1].id).toBe(oldProject.id);
    });

    it("does not expose API keys in list response", async () => {
      await seedProject(db, { ownerId: userId });

      const request = new Request("http://localhost/api/projects", {
        method: "GET",
      });

      const event = createRequestEvent(request, db, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.projects[0]).not.toHaveProperty("apiKey");
    });
  });
});

describe("POST /api/projects", () => {
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
      const request = new Request("http://localhost/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "test-project" }),
      });

      const event = createRequestEvent(request, db);
      await expectHttpError(POST(event as never), 401, { message: "Unauthorized" });
    });
  });

  describe("Creating Projects", () => {
    it("creates project with generated API key", async () => {
      const request = new Request("http://localhost/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "my-new-project" }),
      });

      const event = createRequestEvent(request, db, authenticatedLocals);
      const response = await POST(event as never);

      expect(response.status).toBe(201);
      const body = await response.json();

      expect(body).toHaveProperty("id");
      expect(body).toHaveProperty("name", "my-new-project");
      expect(body).toHaveProperty("apiKey");
      expect(body.apiKey).toMatch(/^lw_[A-Za-z0-9_-]{32}$/);
      expect(body).toHaveProperty("createdAt");
      expect(body).toHaveProperty("updatedAt");

      // Verify project was actually created in database
      const [dbProject] = await db.select().from(project).where(eq(project.id, body.id));
      expect(dbProject).toBeDefined();
      expect(dbProject!.name).toBe("my-new-project");
      expect(dbProject!.apiKeyHash).toBe(hashApiKey(body.apiKey));
    });

    it("returns 400 for duplicate name for same user", async () => {
      // Create existing project
      await seedProject(db, { name: "existing-project", ownerId: userId });

      const request = new Request("http://localhost/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "existing-project" }),
      });

      const event = createRequestEvent(request, db, authenticatedLocals);
      const response = await POST(event as never);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toHaveProperty("error");
      expect(body.error).toBe("duplicate_name");
      expect(body).toHaveProperty("message");
      expect(body.message).toContain("name");
    });

    it("allows different users to create projects with the same name", async () => {
      // Create a project for the first user
      await seedProject(db, { name: "shared-project-name", ownerId: userId });

      // Create a second user
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

      const otherUserLocals = {
        user: sessionData2.user,
        session: sessionData2.session,
      };

      // Second user tries to create a project with the same name
      const request = new Request("http://localhost/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "shared-project-name" }),
      });

      const event = createRequestEvent(request, db, otherUserLocals);
      const response = await POST(event as never);

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body).toHaveProperty("id");
      expect(body).toHaveProperty("name", "shared-project-name");
    });

    it("returns 400 for empty name", async () => {
      const request = new Request("http://localhost/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "" }),
      });

      const event = createRequestEvent(request, db, authenticatedLocals);
      const response = await POST(event as never);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toHaveProperty("error");
      expect(body.error).toBe("validation_error");
    });

    it("returns 400 for name exceeding 50 characters", async () => {
      const request = new Request("http://localhost/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "a".repeat(51) }),
      });

      const event = createRequestEvent(request, db, authenticatedLocals);
      const response = await POST(event as never);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toHaveProperty("error");
      expect(body.error).toBe("validation_error");
    });

    it("returns 400 for name with invalid characters", async () => {
      const request = new Request("http://localhost/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "invalid name!" }),
      });

      const event = createRequestEvent(request, db, authenticatedLocals);
      const response = await POST(event as never);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toHaveProperty("error");
      expect(body.error).toBe("validation_error");
    });

    it("returns 415 for non-JSON Content-Type", async () => {
      const request = new Request("http://localhost/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
        },
        body: JSON.stringify({ name: "test-project" }),
      });

      const event = createRequestEvent(request, db, authenticatedLocals);
      const response = await POST(event as never);

      expect(response.status).toBe(415);
      const body = await response.json();
      expect(body).toHaveProperty("error", "unsupported_media_type");
      expect(body).toHaveProperty("message", "Content-Type must be application/json");
    });

    it("returns 400 for invalid JSON body", async () => {
      const request = new Request("http://localhost/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: "not valid json",
      });

      const event = createRequestEvent(request, db, authenticatedLocals);
      const response = await POST(event as never);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toHaveProperty("error");
    });

    it("returns 400 for missing name field", async () => {
      const request = new Request("http://localhost/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      const event = createRequestEvent(request, db, authenticatedLocals);
      const response = await POST(event as never);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toHaveProperty("error");
      expect(body.error).toBe("validation_error");
    });

    it("generates unique API keys for each project", async () => {
      // Create two projects
      const request1 = new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "project-one" }),
      });

      const request2 = new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "project-two" }),
      });

      const event1 = createRequestEvent(request1, db, authenticatedLocals);
      const event2 = createRequestEvent(request2, db, authenticatedLocals);

      const response1 = await POST(event1 as never);
      const response2 = await POST(event2 as never);

      expect(response1.status).toBe(201);
      expect(response2.status).toBe(201);

      const body1 = await response1.json();
      const body2 = await response2.json();

      expect(body1.apiKey).not.toBe(body2.apiKey);
    });

    it("accepts valid name with hyphens and underscores", async () => {
      const request = new Request("http://localhost/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "my-project_v2" }),
      });

      const event = createRequestEvent(request, db, authenticatedLocals);
      const response = await POST(event as never);

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.name).toBe("my-project_v2");
    });
  });
});
