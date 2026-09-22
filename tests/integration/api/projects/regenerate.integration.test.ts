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
import { POST as POST_REGENERATE } from "../../../../src/routes/api/projects/[id]/regenerate/+server";
import { seedProject, seedProjectWithApiKey } from "../../../fixtures/db";

function createRequestEvent(
  request: Request,
  db: PgliteDatabase<typeof schema>,
  params: { id: string },
  locals: Partial<App.Locals> = {},
): Parameters<typeof POST_REGENERATE>[0] {
  const safeMethod = ["GET", "HEAD", "OPTIONS"].includes(request.method);
  const hasOrigin = request.headers.has("Origin");

  const effectiveRequest =
    !safeMethod && !hasOrigin
      ? new Request(request, {
          headers: { ...Object.fromEntries(request.headers), Origin: new URL(request.url).origin },
        })
      : request;

  const event: Partial<Parameters<typeof POST_REGENERATE>[0]> = {
    request: effectiveRequest,
    locals: { db, ...locals },
    params,
    url: new URL(request.url),
    platform: undefined,
    route: { id: "/api/projects/[id]/regenerate" },
    isDataRequest: false,
    isSubRequest: false,
    isRemoteRequest: false,
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
  };

  // SAFETY: requireAuth, getDbClient, checkCsrfOrigin and the handler's params.id lookup read
  // only event.locals, event.request, event.url and event.params.id — all set above — and
  // event.route.id is "/api/projects/[id]/regenerate", so the unauthenticated test takes
  // requireAuth's 401 branch; the omitted tracing member (previously null) is never accessed.
  return event as Parameters<typeof POST_REGENERATE>[0];
}

async function expectHttpError(promise: Promise<unknown>, expectedStatus: number): Promise<void> {
  try {
    await promise;
    expect.fail("Expected HTTP error to be thrown");
  } catch (error) {
    // SAFETY: this helper is only awaited on the POST_REGENERATE promise, and the route reports
    // failures by throwing SvelteKit's error()/httpError() values — the HttpError shape whose
    // .status is asserted here.
    const httpError = error as HttpError;
    expect(httpError.status).toBe(expectedStatus);
  }
}

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

    const signUpResult = await auth.api.signUpEmail({
      body: {
        email: "regen-test@example.com",
        password: "SecureP@ssw0rd123",
        name: "Regen User",
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

  it("returns 401 for unauthenticated request", async () => {
    const testProject = await seedProject(db, { ownerId: userId });

    const request = new Request(`http://localhost/api/projects/${testProject.id}/regenerate`, {
      method: "POST",
      headers: { Origin: "http://localhost" },
    });

    const event = createRequestEvent(request, db, { id: testProject.id });
    await expectHttpError(POST_REGENERATE(event), 401);
  });

  it("returns 404 for project not owned by user", async () => {
    const otherUser = await auth.api.signUpEmail({
      body: {
        email: "other@example.com",
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

    const request = new Request(`http://localhost/api/projects/${otherProject.id}/regenerate`, {
      method: "POST",
      headers: { Origin: "http://localhost" },
    });

    const event = createRequestEvent(request, db, { id: otherProject.id }, authenticatedLocals);
    const response = await POST_REGENERATE(event);
    expect(response.status).toBe(404);
  });

  it("returns a new API key different from the old one", async () => {
    const testProject = await seedProjectWithApiKey(db, { ownerId: userId });
    const oldApiKey = testProject.apiKey;

    const request = new Request(`http://localhost/api/projects/${testProject.id}/regenerate`, {
      method: "POST",
      headers: { Origin: "http://localhost" },
    });

    const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
    const response = await POST_REGENERATE(event);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("apiKey");
    expect(body.apiKey).not.toBe(oldApiKey);
    expect(body.apiKey).toMatch(/^lw_[A-Za-z0-9_-]{32}$/);
  });

  it("updates the API key in the database", async () => {
    const testProject = await seedProjectWithApiKey(db, { ownerId: userId });

    const request = new Request(`http://localhost/api/projects/${testProject.id}/regenerate`, {
      method: "POST",
      headers: { Origin: "http://localhost" },
    });

    const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
    const response = await POST_REGENERATE(event);

    expect(response.status).toBe(200);
    const body = await response.json();

    const [dbProject] = await db
      .select({ apiKeyHash: project.apiKeyHash })
      .from(project)
      .where(eq(project.id, testProject.id));

    expect(dbProject).toBeDefined();
    expect(dbProject!.apiKeyHash).toBe(hashApiKey(body.apiKey));
    expect(dbProject!.apiKeyHash).not.toBe(hashApiKey(testProject.apiKey));
  });

  it("rejects cross-origin request (CSRF)", async () => {
    const testProject = await seedProject(db, { ownerId: userId });

    const request = new Request(`http://localhost/api/projects/${testProject.id}/regenerate`, {
      method: "POST",
      headers: { Origin: "https://evil.com" },
    });

    const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
    const response = await POST_REGENERATE(event);

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("csrf_error");
  });
});
