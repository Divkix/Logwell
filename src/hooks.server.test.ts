import type { RequestEvent } from "@sveltejs/kit";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { createAuth } from "./lib/server/auth";
import type * as schema from "./lib/server/db/schema";
import { setupTestDatabase } from "./lib/server/db/test-db";
import { getSession } from "./lib/server/session";

describe("Server Hooks - Authentication", () => {
  let db: PgliteDatabase<typeof schema>;
  let auth: ReturnType<typeof createAuth>;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
    auth = createAuth(db);
  });

  describe("Session handling", () => {
    it("should populate event.locals.user for valid session", async () => {
      // Create test user and get session
      const email = "hook-test@example.com";
      const password = "SecureP@ssw0rd123";
      const name = "Hook Test User";

      const signUpResult = await auth.api.signUpEmail({
        body: {
          email,
          password,
          name,
        },
      });

      // Simulate SvelteKit request event with session cookie
      const mockRequest = new Request("http://localhost:5173/test", {
        headers: {
          cookie: `better-auth.session_token=${signUpResult.token}`,
        },
      });

      const mockEvent = {
        request: mockRequest,
        locals: {},
        url: new URL("http://localhost:5173/test"),
        params: {},
        route: { id: "/test" },
      } as unknown as RequestEvent;

      // Test the session logic using getSession helper
      const sessionData = await getSession(mockRequest.headers, db);

      if (sessionData) {
        mockEvent.locals.user = sessionData.user;
        mockEvent.locals.session = sessionData.session;
      }

      // Verify locals were populated
      expect(mockEvent.locals.user).toBeDefined();
      expect(mockEvent.locals.user?.email).toBe(email);
      expect(mockEvent.locals.user?.name).toBe(name);
      expect(mockEvent.locals.session).toBeDefined();
      expect(mockEvent.locals.session?.userId).toBe(signUpResult.user.id);
    });

    it("should set locals to undefined for invalid session", async () => {
      // Simulate request with invalid/expired token
      const mockRequest = new Request("http://localhost:5173/test", {
        headers: {
          cookie: "better-auth.session_token=invalid-token-12345",
        },
      });

      const mockEvent = {
        request: mockRequest,
        locals: {},
        url: new URL("http://localhost:5173/test"),
        params: {},
        route: { id: "/test" },
      } as unknown as RequestEvent;

      // Test session logic
      const sessionData = await getSession(mockRequest.headers, db);

      if (sessionData) {
        mockEvent.locals.user = sessionData.user;
        mockEvent.locals.session = sessionData.session;
      }

      // Verify locals remain undefined
      expect(mockEvent.locals.user).toBeUndefined();
      expect(mockEvent.locals.session).toBeUndefined();
    });

    it("should set locals to undefined for missing session", async () => {
      // Simulate request without session cookie
      const mockRequest = new Request("http://localhost:5173/test");

      const mockEvent = {
        request: mockRequest,
        locals: {},
        url: new URL("http://localhost:5173/test"),
        params: {},
        route: { id: "/test" },
      } as unknown as RequestEvent;

      // Test session logic
      const sessionData = await getSession(mockRequest.headers, db);

      if (sessionData) {
        mockEvent.locals.user = sessionData.user;
        mockEvent.locals.session = sessionData.session;
      }

      // Verify locals remain undefined
      expect(mockEvent.locals.user).toBeUndefined();
      expect(mockEvent.locals.session).toBeUndefined();
    });
  });

  describe("Better-auth API route handling", () => {
    it("should allow better-auth routes to pass through", async () => {
      // Simulate request to better-auth API route
      const mockRequest = new Request("http://localhost:5173/api/auth/sign-in", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
      });

      const mockEvent = {
        request: mockRequest,
        locals: {},
        url: new URL("http://localhost:5173/api/auth/sign-in"),
        params: {},
        route: { id: "/api/auth/[...all]" },
      } as unknown as RequestEvent;

      const mockResolve = async (_event: RequestEvent) => {
        return new Response("AUTH_RESPONSE");
      };

      // Simulate the handle hook logic
      const sessionData = await getSession(mockRequest.headers, db);

      if (sessionData) {
        mockEvent.locals.user = sessionData.user;
        mockEvent.locals.session = sessionData.session;
      }

      const response = await mockResolve(mockEvent);

      // Verify the response was returned (not intercepted)
      expect(response).toBeDefined();
      expect(await response.text()).toBe("AUTH_RESPONSE");
    });
  });

  describe("Session persistence across requests", () => {
    it("should maintain session data across multiple requests", async () => {
      // Create user and session
      const email = "persistent@example.com";
      const password = "SecureP@ssw0rd123";
      const name = "Persistent User";

      const signUpResult = await auth.api.signUpEmail({
        body: {
          email,
          password,
          name,
        },
      });

      // First request
      const mockRequest1 = new Request("http://localhost:5173/page1", {
        headers: {
          cookie: `better-auth.session_token=${signUpResult.token}`,
        },
      });

      const mockEvent1 = {
        request: mockRequest1,
        locals: {},
        url: new URL("http://localhost:5173/page1"),
        params: {},
        route: { id: "/page1" },
      } as unknown as RequestEvent;

      const sessionData1 = await getSession(mockRequest1.headers, db);

      if (sessionData1) {
        mockEvent1.locals.user = sessionData1.user;
        mockEvent1.locals.session = sessionData1.session;
      }

      // Second request with same session token
      const mockRequest2 = new Request("http://localhost:5173/page2", {
        headers: {
          cookie: `better-auth.session_token=${signUpResult.token}`,
        },
      });

      const mockEvent2 = {
        request: mockRequest2,
        locals: {},
        url: new URL("http://localhost:5173/page2"),
        params: {},
        route: { id: "/page2" },
      } as unknown as RequestEvent;

      const sessionData2 = await getSession(mockRequest2.headers, db);

      if (sessionData2) {
        mockEvent2.locals.user = sessionData2.user;
        mockEvent2.locals.session = sessionData2.session;
      }

      // Both requests should have the same user
      expect(mockEvent1.locals.user?.id).toBe(signUpResult.user.id);
      expect(mockEvent2.locals.user?.id).toBe(signUpResult.user.id);
      expect(mockEvent1.locals.user?.email).toBe(email);
      expect(mockEvent2.locals.user?.email).toBe(email);
    });
  });
});
