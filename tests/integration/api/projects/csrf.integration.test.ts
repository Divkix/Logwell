import type { PgliteDatabase } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createAuth } from "$lib/server/auth";
import type * as schema from "$lib/server/db/schema";
import { setupTestDatabase } from "$lib/server/db/test-db";
import { getSession } from "$lib/server/session";
import { POST as POST_PROJECTS } from "../../../../src/routes/api/projects/+server";

function createRequestEvent(
  request: Request,
  db: PgliteDatabase<typeof schema>,
  locals: Partial<App.Locals> = {},
  params: Record<string, string> = {},
) {
  return {
    request,
    locals: { db, ...locals },
    params,
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

describe("CSRF Origin/Referer checks", () => {
  let db: PgliteDatabase<typeof schema>;
  let cleanup: () => Promise<void>;
  let auth: ReturnType<typeof createAuth>;
  let authenticatedLocals: Partial<App.Locals>;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
    auth = createAuth(db);

    const signUpResult = await auth.api.signUpEmail({
      body: {
        email: "csrf-test@example.com",
        password: "SecureP@ssw0rd123",
        name: "CSRF Test User",
      },
    });

    const mockRequest = new Request("http://localhost:5173", {
      headers: {
        cookie: `better-auth.session_token=${signUpResult.token}`,
      },
    });

    const sessionData = await getSession(mockRequest.headers, db);
    if (!sessionData) throw new Error("Session data should not be null");

    authenticatedLocals = {
      user: sessionData.user,
      session: sessionData.session,
    };
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("POST /api/projects (route wiring)", () => {
    it("rejects a state-changing request with a mismatched Origin", async () => {
      const request = new Request("http://localhost/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://evil.com",
        },
        body: JSON.stringify({ name: "csrf-test" }),
      });

      const event = createRequestEvent(request, db, authenticatedLocals);
      const response = await POST_PROJECTS(event as never);

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe("csrf_error");
    });

    it("allows a state-changing request with a valid Origin", async () => {
      const request = new Request("http://localhost/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost",
        },
        body: JSON.stringify({ name: "csrf-valid" }),
      });

      const event = createRequestEvent(request, db, authenticatedLocals);
      const response = await POST_PROJECTS(event as never);

      expect(response.status).toBe(201);
    });
  });
});
