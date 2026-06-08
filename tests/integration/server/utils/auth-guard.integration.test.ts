import type { HttpError, Redirect, RequestEvent } from "@sveltejs/kit";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { createAuth } from "$lib/server/auth";
import type * as schema from "$lib/server/db/schema";
import { setupTestDatabase } from "$lib/server/db/test-db";
import { getSession } from "$lib/server/session";
import { requireAuth } from "$lib/server/utils/auth-guard";

/**
 * Helper to assert that a promise rejects with a SvelteKit redirect
 */
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

describe("Auth Guard - requireAuth", () => {
  let db: PgliteDatabase<typeof schema>;
  let auth: ReturnType<typeof createAuth>;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
    auth = createAuth(db);
  });

  it("throws redirect for unauthenticated page route request", async () => {
    // Create mock event with no session
    const mockRequest = new Request("http://localhost:5173/dashboard");
    const mockEvent = {
      request: mockRequest,
      locals: {}, // No user or session
      url: new URL("http://localhost:5173/dashboard"),
      params: {},
      route: { id: "/dashboard" },
    } as unknown as RequestEvent;

    // requireAuth should throw a redirect to /login
    await expectRedirect(requireAuth(mockEvent), 303, "/login");
  });

  it("throws JSON 401 for unauthenticated API route request", async () => {
    const mockRequest = new Request("http://localhost:5173/api/projects", {
      headers: { Accept: "application/json" },
    });
    const mockEvent = {
      request: mockRequest,
      locals: {},
      url: new URL("http://localhost:5173/api/projects"),
      params: {},
      route: { id: "/api/projects" },
    } as unknown as RequestEvent;

    await expectHttpError(requireAuth(mockEvent), 401, {
      message: "Unauthorized",
    });
  });

  it("throws JSON 401 for nested API route request", async () => {
    const mockRequest = new Request("http://localhost:5173/api/projects/123/logs", {
      headers: { Accept: "application/json" },
    });
    const mockEvent = {
      request: mockRequest,
      locals: {},
      url: new URL("http://localhost:5173/api/projects/123/logs"),
      params: { id: "123" },
      route: { id: "/api/projects/[id]/logs" },
    } as unknown as RequestEvent;

    await expectHttpError(requireAuth(mockEvent), 401, {
      message: "Unauthorized",
    });
  });

  it("throws redirect when session is missing but user exists", async () => {
    const mockRequest = new Request("http://localhost:5173/dashboard");
    const mockEvent = {
      request: mockRequest,
      locals: {
        user: { id: "user-123", email: "test@example.com", name: "Test" },
        // session is missing
      },
      url: new URL("http://localhost:5173/dashboard"),
      params: {},
      route: { id: "/dashboard" },
    } as unknown as RequestEvent;

    await expectRedirect(requireAuth(mockEvent), 303, "/login");
  });

  it("throws redirect when user is missing but session exists", async () => {
    const mockRequest = new Request("http://localhost:5173/dashboard");
    const mockEvent = {
      request: mockRequest,
      locals: {
        // user is missing
        session: { id: "session-123", userId: "user-123", expiresAt: new Date() },
      },
      url: new URL("http://localhost:5173/dashboard"),
      params: {},
      route: { id: "/dashboard" },
    } as unknown as RequestEvent;

    await expectRedirect(requireAuth(mockEvent), 303, "/login");
  });

  it("returns session data for authenticated request", async () => {
    // Create test user and session
    const email = "auth-guard-test@example.com";
    const password = "SecureP@ssw0rd123";
    const name = "Auth Guard Test User";

    const signUpResult = await auth.api.signUpEmail({
      body: { email, password, name },
    });

    // Get session from database
    const mockRequest = new Request("http://localhost:5173/dashboard", {
      headers: {
        cookie: `better-auth.session_token=${signUpResult.token}`,
      },
    });

    const sessionData = await getSession(mockRequest.headers, db);
    expect(sessionData).not.toBeNull();
    if (!sessionData) throw new Error("Session data should not be null");

    // Create mock event with authenticated session
    const mockEvent = {
      request: mockRequest,
      locals: {
        user: sessionData.user,
        session: sessionData.session,
      },
      url: new URL("http://localhost:5173/dashboard"),
      params: {},
      route: { id: "/dashboard" },
    } as unknown as RequestEvent;

    // requireAuth should return the session data
    const result = await requireAuth(mockEvent);

    expect(result.user).toBeDefined();
    expect(result.user.id).toBe(signUpResult.user.id);
    expect(result.user.email).toBe(email);
    expect(result.user.name).toBe(name);
    expect(result.session).toBeDefined();
    expect(result.session.userId).toBe(signUpResult.user.id);
  });

  it("returns non-optional types for user and session", async () => {
    // Create test user
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

    const mockEvent = {
      request: mockRequest,
      locals: {
        user: sessionData.user,
        session: sessionData.session,
      },
      url: new URL("http://localhost:5173/dashboard"),
      params: {},
      route: { id: "/dashboard" },
    } as unknown as RequestEvent;

    const result = await requireAuth(mockEvent);

    // TypeScript should allow direct access without optional chaining
    // This verifies the return type is { user: User; session: Session } not optional
    const userId: string = result.user.id;
    const sessionId: string = result.session.id;

    expect(userId).toBe(signUpResult.user.id);
    expect(sessionId).toBeDefined();
  });
});
