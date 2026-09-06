import type { HttpError, Redirect, RequestEvent } from "@sveltejs/kit";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { createAuth } from "$lib/server/auth";
import type * as schema from "$lib/server/db/schema";
import { setupTestDatabase } from "$lib/server/db/test-db";
import { getSession } from "$lib/server/session";
import {
  requireAuth,
  requireOwnedProjectPage,
  requireOwnedProjectRoute,
} from "$lib/server/utils/owned-project";
import { seedProject } from "../../../fixtures/db";

async function expectRedirect(
  promise: Promise<unknown>,
  expectedStatus: number,
  expectedLocation: string,
): Promise<void> {
  try {
    await promise;
    expect.fail("Expected redirect to be thrown");
  } catch (error) {
    const redirect = error as Redirect;
    expect(redirect.status).toBe(expectedStatus);
    expect(redirect.location).toBe(expectedLocation);
  }
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

describe("Auth Guard - requireAuth", () => {
  let db: PgliteDatabase<typeof schema>;
  let auth: ReturnType<typeof createAuth>;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
    auth = createAuth(db);
  });

  function mockEvent(
    request: Request,
    locals: Record<string, unknown> = {},
    params: Record<string, string> = {},
    routeId = "/dashboard",
  ): RequestEvent {
    return {
      request,
      locals,
      url: new URL(request.url),
      params,
      route: { id: routeId },
    } as unknown as RequestEvent;
  }

  async function signIn(email = "owned-test@example.com") {
    const signUpResult = await auth.api.signUpEmail({
      body: { email, password: "SecureP@ssw0rd123", name: "Owned Test" },
    });
    const sessionRequest = new Request("http://localhost:5173", {
      headers: { cookie: `better-auth.session_token=${signUpResult.token}` },
    });
    const sessionData = await getSession(sessionRequest.headers, db);
    if (!sessionData) throw new Error("Session data should not be null");
    return sessionData;
  }

  it("throws redirect for unauthenticated page route request", async () => {
    const event = mockEvent(new Request("http://localhost:5173/dashboard"));

    await expectRedirect(requireAuth(event), 303, "/login");
  });

  it("throws JSON 401 for unauthenticated API route request", async () => {
    const event = mockEvent(
      new Request("http://localhost:5173/api/projects", {
        headers: { Accept: "application/json" },
      }),
      {},
      {},
      "/api/projects",
    );

    await expectHttpError(requireAuth(event), 401, {
      message: "Unauthorized",
    });
  });

  it("throws JSON 401 for nested API route request", async () => {
    const event = mockEvent(
      new Request("http://localhost:5173/api/projects/123/logs", {
        headers: { Accept: "application/json" },
      }),
      {},
      { id: "123" },
      "/api/projects/[id]/logs",
    );

    await expectHttpError(requireAuth(event), 401, {
      message: "Unauthorized",
    });
  });

  it("throws redirect when session is missing but user exists", async () => {
    const event = mockEvent(new Request("http://localhost:5173/dashboard"), {
      user: { id: "user-123", email: "test@example.com", name: "Test" },
    });

    await expectRedirect(requireAuth(event), 303, "/login");
  });

  it("throws redirect when user is missing but session exists", async () => {
    const event = mockEvent(new Request("http://localhost:5173/dashboard"), {
      session: { id: "session-123", userId: "user-123", expiresAt: new Date() },
    });

    await expectRedirect(requireAuth(event), 303, "/login");
  });

  it("returns session data for authenticated request", async () => {
    const email = "auth-guard-test@example.com";
    const password = "SecureP@ssw0rd123";
    const name = "Auth Guard Test User";

    const signUpResult = await auth.api.signUpEmail({
      body: { email, password, name },
    });

    const mockRequest = new Request("http://localhost:5173/dashboard", {
      headers: {
        cookie: `better-auth.session_token=${signUpResult.token}`,
      },
    });

    const sessionData = await getSession(mockRequest.headers, db);
    expect(sessionData).not.toBeNull();
    if (!sessionData) throw new Error("Session data should not be null");

    const event = mockEvent(mockRequest, {
      user: sessionData.user,
      session: sessionData.session,
    });

    const result = await requireAuth(event);

    expect(result.user).toBeDefined();
    expect(result.user.id).toBe(signUpResult.user.id);
    expect(result.user.email).toBe(email);
    expect(result.user.name).toBe(name);
    expect(result.session).toBeDefined();
    expect(result.session.userId).toBe(signUpResult.user.id);
  });

  it("returns non-optional types for user and session", async () => {
    const signUpResult = await auth.api.signUpEmail({
      body: {
        email: "types-test@example.com",
        password: "SecureP@ssw0rd123",
        name: "Types Test",
      },
    });

    const mockRequest = new Request("http://localhost:5173/dashboard", {
      headers: {
        cookie: `better-auth.session_token=${signUpResult.token}`,
      },
    });

    const sessionData = await getSession(mockRequest.headers, db);
    expect(sessionData).not.toBeNull();
    if (!sessionData) throw new Error("Session data should not be null");

    const event = mockEvent(mockRequest, {
      user: sessionData.user,
      session: sessionData.session,
    });

    const result = await requireAuth(event);

    const userId: string = result.user.id;
    const sessionId: string = result.session.id;

    expect(userId).toBe(signUpResult.user.id);
    expect(sessionId).toBeDefined();
  });

  describe("requireOwnedProjectRoute", () => {
    function routeEvent(request: Request, locals: Partial<App.Locals>): RequestEvent {
      return mockEvent(request, { db, ...locals }, {}, "/api/projects/[id]/regenerate");
    }

    it("rejects a CSRF-less POST before the ownership lookup", async () => {
      const { user, session } = await signIn();
      const request = new Request("http://localhost/api/projects/does-not-exist/regenerate", {
        method: "POST",
      });
      const result = await requireOwnedProjectRoute(
        routeEvent(request, { user, session }),
        "does-not-exist",
      );
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(403);
    });

    it("returns 404 (not 403) for a project the user does not own", async () => {
      const { user, session } = await signIn();
      const request = new Request("http://localhost/api/projects/does-not-exist");
      const result = await requireOwnedProjectRoute(
        routeEvent(request, { user, session }),
        "does-not-exist",
      );
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(404);
      expect(await (result as Response).json()).toEqual({
        error: "not_found",
        message: "Project not found",
      });
    });

    it("still enforces ownership when CSRF passes", async () => {
      const { user, session } = await signIn();
      const request = new Request("http://localhost/api/projects/does-not-exist/regenerate", {
        method: "POST",
        headers: { Origin: "http://localhost" },
      });
      const result = await requireOwnedProjectRoute(
        routeEvent(request, { user, session }),
        "does-not-exist",
      );
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(404);
    });

    it("returns project and db for an owned project", async () => {
      const { user, session } = await signIn();
      const seeded = await seedProject(db, { ownerId: user.id, name: "owned-project" });
      const request = new Request(`http://localhost/api/projects/${seeded.id}`);
      const result = await requireOwnedProjectRoute(
        routeEvent(request, { user, session }),
        seeded.id,
      );
      if (result instanceof Response) throw new Error("Expected owned project, got Response");
      expect(result.project.id).toBe(seeded.id);
      expect(result.project.ownerId).toBe(user.id);
      expect(result.db).toBeDefined();
    });
  });

  describe("requireOwnedProjectPage", () => {
    it("throws 404 for a project the user does not own", async () => {
      const { user, session } = await signIn();
      const event = mockEvent(
        new Request("http://localhost:5173/projects/does-not-exist"),
        { db, user, session },
        { id: "does-not-exist" },
        "/(app)/projects/[id]",
      );

      await expectHttpError(requireOwnedProjectPage(event, "does-not-exist"), 404, {
        message: "Project not found",
      });
    });
  });
});
