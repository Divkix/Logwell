import type { HttpError } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createAuth } from "$lib/server/auth";
import type * as schema from "$lib/server/db/schema";
import { project } from "$lib/server/db/schema";
import { setupTestDatabase } from "$lib/server/db/test-db";
import { getSession } from "$lib/server/session";
import { hashApiKey } from "$lib/server/utils/api-key";
import { GET, POST } from "../../../../src/routes/api/projects/+server";
import {
  DELETE as DELETE_BY_ID,
  GET as GET_BY_ID,
  PATCH as PATCH_BY_ID,
} from "../../../../src/routes/api/projects/[id]/+server";
import { seedLogs, seedProject, seedProjects } from "../../../fixtures/db";

function createIdRequestEvent(
  request: Request,
  db: PgliteDatabase<typeof schema>,
  id: string,
  locals: Partial<App.Locals> = {},
) {
  return {
    request,
    locals: { db, ...locals },
    params: { id },
    url: new URL(request.url),
  } as unknown as Parameters<typeof GET_BY_ID>[0];
}

function createRequestEvent(
  request: Request,
  db: PgliteDatabase<typeof schema>,
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
      const [project1, project2] = await seedProjects(db, 2, { ownerId: userId });

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
      const oldProject = await seedProject(db, { name: "old-project", ownerId: userId });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const newProject = await seedProject(db, { name: "new-project", ownerId: userId });

      const request = new Request("http://localhost/api/projects", {
        method: "GET",
      });

      const event = createRequestEvent(request, db, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body.projects[0].id).toBe(newProject.id);
      expect(body.projects[1].id).toBe(oldProject.id);
    });

    it("computes log counts with a single GROUP BY query (no per-project COUNT loop)", async () => {
      const [project1, project2] = await seedProjects(db, 2, { ownerId: userId });
      await seedLogs(db, project1!.id, 5);

      const originalSelect = db.select.bind(db);
      vi.spyOn(db, "select").mockImplementation(((fields?: unknown) => {
        if (fields && typeof fields === "object" && "count" in fields && !("projectId" in fields)) {
          throw new Error("project list must aggregate log counts in SQL");
        }
        return originalSelect(fields as never);
      }) as typeof db.select);

      const request = new Request("http://localhost/api/projects", {
        method: "GET",
      });

      const event = createRequestEvent(request, db, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.projects).toHaveLength(2);

      const returnedProject1 = body.projects.find((p: { id: string }) => p.id === project1!.id);
      const returnedProject2 = body.projects.find((p: { id: string }) => p.id === project2!.id);
      expect(returnedProject1.logCount).toBe(5);
      expect(returnedProject2.logCount).toBe(0);
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

      const [dbProject] = await db.select().from(project).where(eq(project.id, body.id));
      expect(dbProject).toBeDefined();
      expect(dbProject!.name).toBe("my-new-project");
      expect(dbProject!.apiKeyHash).toBe(hashApiKey(body.apiKey));
    });

    it("returns 400 for duplicate name for same user", async () => {
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
      await seedProject(db, { name: "shared-project-name", ownerId: userId });

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

describe("GET /api/projects/[id] (canonical detail home)", () => {
  let db: PgliteDatabase<typeof schema>;
  let cleanup: () => Promise<void>;
  let authenticatedLocals: Partial<App.Locals>;
  let userId: string;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
    const auth = createAuth(db);
    const signUpResult = await auth.api.signUpEmail({
      body: { email: "detail@example.com", password: "SecureP@ssw0rd123", name: "Detail User" },
    });
    const sessionData = await getSession(
      new Request("http://localhost:5173", {
        headers: { cookie: `better-auth.session_token=${signUpResult.token}` },
      }).headers,
      db,
    );
    if (!sessionData) throw new Error("Session data should not be null");
    userId = sessionData.user.id;
    authenticatedLocals = { user: sessionData.user, session: sessionData.session };
  });

  afterEach(async () => {
    await cleanup();
  });

  it("returns the project with log stats and no API key", async () => {
    const testProject = await seedProject(db, { name: "my-test-project", ownerId: userId });
    await seedLogs(db, testProject.id, 3, { level: "info" });
    await seedLogs(db, testProject.id, 2, { level: "error" });

    const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
      method: "GET",
    });
    const response = await GET_BY_ID(
      createIdRequestEvent(request, db, testProject.id, authenticatedLocals),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ id: testProject.id, name: "my-test-project" });
    expect(body).not.toHaveProperty("apiKey");
    expect(body.stats.totalLogs).toBe(5);
    expect(body.stats.levelCounts).toMatchObject({ info: 3, error: 2 });
  });

  it("returns retentionDays as stored (null, 0, 365)", async () => {
    for (const retentionDays of [null, 0, 365] as const) {
      const testProject = await seedProject(db, { ownerId: userId, retentionDays });
      const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
        method: "GET",
      });
      const response = await GET_BY_ID(
        createIdRequestEvent(request, db, testProject.id, authenticatedLocals),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ retentionDays });
    }
  });

  it("removes the project and its logs on DELETE", async () => {
    const testProject = await seedProject(db, { ownerId: userId });
    await seedLogs(db, testProject.id, 5);

    const request = new Request(`http://localhost/api/projects/${testProject.id}`, {
      method: "DELETE",
      headers: { Origin: "http://localhost" },
    });
    const response = await DELETE_BY_ID(
      createIdRequestEvent(request, db, testProject.id, authenticatedLocals),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, id: testProject.id });

    const retry = await GET_BY_ID(
      createIdRequestEvent(
        new Request(`http://localhost/api/projects/${testProject.id}`, { method: "GET" }),
        db,
        testProject.id,
        authenticatedLocals,
      ),
    );
    expect(retry.status).toBe(404);
  });
});

describe("PATCH /api/projects/[id] (canonical patch home)", () => {
  let db: PgliteDatabase<typeof schema>;
  let cleanup: () => Promise<void>;
  let authenticatedLocals: Partial<App.Locals>;
  let userId: string;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
    const auth = createAuth(db);
    const signUpResult = await auth.api.signUpEmail({
      body: { email: "patch@example.com", password: "SecureP@ssw0rd123", name: "Patch User" },
    });
    const sessionData = await getSession(
      new Request("http://localhost:5173", {
        headers: { cookie: `better-auth.session_token=${signUpResult.token}` },
      }).headers,
      db,
    );
    if (!sessionData) throw new Error("Session data should not be null");
    userId = sessionData.user.id;
    authenticatedLocals = { user: sessionData.user, session: sessionData.session };
  });

  afterEach(async () => {
    await cleanup();
  });

  function patchRequest(id: string, body: unknown) {
    return new Request(`http://localhost/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: JSON.stringify(body),
    });
  }

  it("renames the project", async () => {
    const testProject = await seedProject(db, { name: "old-name", ownerId: userId });

    const response = await PATCH_BY_ID(
      createIdRequestEvent(
        patchRequest(testProject.id, { name: "new-name" }),
        db,
        testProject.id,
        authenticatedLocals,
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: testProject.id, name: "new-name" });
  });

  it("rejects a duplicate name for the same owner", async () => {
    await seedProject(db, { name: "existing-project", ownerId: userId });
    const testProject = await seedProject(db, { name: "my-project", ownerId: userId });

    const response = await PATCH_BY_ID(
      createIdRequestEvent(
        patchRequest(testProject.id, { name: "existing-project" }),
        db,
        testProject.id,
        authenticatedLocals,
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "duplicate_name" });
  });

  it.each([
    ["empty name", { name: "" }],
    ["over-long name", { name: "a".repeat(51) }],
    ["invalid characters", { name: "invalid name!" }],
  ])("rejects rename with %s", async (_label, body) => {
    const testProject = await seedProject(db, { name: "my-project", ownerId: userId });

    const response = await PATCH_BY_ID(
      createIdRequestEvent(
        patchRequest(testProject.id, body),
        db,
        testProject.id,
        authenticatedLocals,
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "validation_error" });
  });

  it("updates retentionDays", async () => {
    const testProject = await seedProject(db, { ownerId: userId });

    const response = await PATCH_BY_ID(
      createIdRequestEvent(
        patchRequest(testProject.id, { retentionDays: 90 }),
        db,
        testProject.id,
        authenticatedLocals,
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ retentionDays: 90 });
  });

  it.each([
    ["null (system default)", null],
    ["0 (never delete)", 0],
  ])("accepts retentionDays %s", async (_label, retentionDays) => {
    const testProject = await seedProject(db, { ownerId: userId });

    const response = await PATCH_BY_ID(
      createIdRequestEvent(
        patchRequest(testProject.id, { retentionDays }),
        db,
        testProject.id,
        authenticatedLocals,
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ retentionDays });
  });

  it("updates name and retentionDays together", async () => {
    const testProject = await seedProject(db, { name: "before", ownerId: userId });

    const response = await PATCH_BY_ID(
      createIdRequestEvent(
        patchRequest(testProject.id, { name: "after", retentionDays: 30 }),
        db,
        testProject.id,
        authenticatedLocals,
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ name: "after", retentionDays: 30 });
  });

  it("allows a name shared with another owner's project", async () => {
    await seedProject(db, { name: "shared-name" });
    const testProject = await seedProject(db, { name: "my-project", ownerId: userId });

    const response = await PATCH_BY_ID(
      createIdRequestEvent(
        patchRequest(testProject.id, { name: "shared-name" }),
        db,
        testProject.id,
        authenticatedLocals,
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ name: "shared-name" });
  });

  it("returns 404 for a missing project", async () => {
    const response = await PATCH_BY_ID(
      createIdRequestEvent(
        patchRequest("no-such-project", { name: "x" }),
        db,
        "no-such-project",
        authenticatedLocals,
      ),
    );

    expect(response.status).toBe(404);
  });

  it("leaves retentionDays unchanged when omitted and keeps updatedAt on empty body", async () => {
    const testProject = await seedProject(db, { name: "keep", ownerId: userId });

    const renamed = await PATCH_BY_ID(
      createIdRequestEvent(
        patchRequest(testProject.id, { name: "kept" }),
        db,
        testProject.id,
        authenticatedLocals,
      ),
    );
    const renamedBody = await renamed.json();
    expect(renamedBody).toMatchObject({ name: "kept", retentionDays: testProject.retentionDays });

    const untouched = await PATCH_BY_ID(
      createIdRequestEvent(
        patchRequest(testProject.id, {}),
        db,
        testProject.id,
        authenticatedLocals,
      ),
    );
    expect(untouched.status).toBe(200);
    expect((await untouched.json()).updatedAt).toBe(renamedBody.updatedAt);
  });

  it.each([
    ["negative", { retentionDays: -1 }],
    ["exceeds max", { retentionDays: 3651 }],
    ["non-integer", { retentionDays: 30.5 }],
  ])("rejects retentionDays %s", async (_label, body) => {
    const testProject = await seedProject(db, { ownerId: userId });

    const response = await PATCH_BY_ID(
      createIdRequestEvent(
        patchRequest(testProject.id, body),
        db,
        testProject.id,
        authenticatedLocals,
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "validation_error" });
  });
});
