import type { RequestEvent } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { LOGIN_RPM } from "./lib/server/utils/rate-limit";
import { handle } from "./hooks.server";

// SAFETY: beforeEach assigns ORIGIN a concrete origin string and the unset-origin test
// assigns undefined, so the field's type must widen past the undefined literal.
const mocks = vi.hoisted(() => ({
  db: { kind: "test-db" },
  getSession: vi.fn(),
  authHandler: vi.fn(),
  // RATE_LIMIT_INGEST_IP_RPM is overridden in the /v1 throttle tests; the shipped
  // default is 60000/min, too high to reach in a unit test.
  env: { ORIGIN: undefined as string | undefined, RATE_LIMIT_INGEST_IP_RPM: 3 },
}));

vi.mock("$app/environment", () => ({ building: false }));

vi.mock("$lib/server/db", () => ({ db: mocks.db }));

vi.mock("$lib/server/config/env", () => ({ env: mocks.env }));

vi.mock("$lib/server/auth", () => ({
  initAuth: vi.fn(),
  auth: {
    options: { baseURL: "http://localhost", basePath: "/api/auth" },
    api: { getSession: mocks.getSession },
    handler: mocks.authHandler,
  },
}));

vi.mock("$lib/server/error-handler", () => ({ handleError: vi.fn() }));

vi.mock("$lib/server/jobs/cleanup-scheduler", () => ({
  startCleanupScheduler: vi.fn(),
  stopCleanupScheduler: vi.fn(),
}));

// The unit project resolves no `$lib` runtime specifiers, so re-export the real modules
// under the specifiers the hook imports — the CSRF and rate-limit logic must run for real.
vi.mock("$lib/server/utils/csrf", async () => await import("./lib/server/utils/csrf"));

vi.mock("$lib/server/utils/rate-limit", async () => await import("./lib/server/utils/rate-limit"));

const ORIGIN = "http://localhost";

function createEvent(url: string, init: RequestInit = {}, address = "203.0.113.10"): RequestEvent {
  const event: Partial<RequestEvent> = {
    request: new Request(url, init),
    url: new URL(url),
    locals: {},
    params: {},
    route: { id: null },
    getClientAddress: () => address,
  };

  // SAFETY: handle, checkCsrfOrigin and better-auth's svelteKitHandler read only request,
  // url, locals and getClientAddress from the event — all set above — and no test reaches
  // handleError, the sole reader of route.id, so the omitted members (cookies, fetch,
  // tracing, setHeaders, platform, …) are never accessed.
  return event as RequestEvent;
}

describe("hooks.server handle", () => {
  const resolve = vi.fn(async (_event: RequestEvent) => new Response("resolved"));

  beforeEach(() => {
    resolve.mockClear();
    mocks.getSession.mockReset().mockResolvedValue(null);
    mocks.authHandler.mockReset().mockImplementation(() => new Response("auth-handler"));
    mocks.env.ORIGIN = ORIGIN;
  });

  describe("session resolution", () => {
    it("populates locals.user, locals.session and locals.db for a valid session", async () => {
      const session = { id: "sess_1", userId: "user_1", expiresAt: new Date(Date.now() + 60_000) };
      const user = { id: "user_1", email: "hook@example.com", name: "Hook User" };
      mocks.getSession.mockResolvedValue({ session, user });

      const event = createEvent(`${ORIGIN}/dashboard`);
      const response = await handle({ event, resolve });

      expect(await response.text()).toBe("resolved");
      expect(resolve).toHaveBeenCalledWith(event);
      expect(mocks.getSession).toHaveBeenCalledWith({ headers: event.request.headers });
      expect(event.locals.db).toBe(mocks.db);
      expect(event.locals.user).toBe(user);
      expect(event.locals.session).toBe(session);
    });

    it("leaves locals.user and locals.session unset without a session", async () => {
      const event = createEvent(`${ORIGIN}/dashboard`);
      await handle({ event, resolve });

      expect(event.locals.db).toBe(mocks.db);
      expect(event.locals.user).toBeUndefined();
      expect(event.locals.session).toBeUndefined();
      expect(resolve).toHaveBeenCalledWith(event);
    });
  });

  describe("fast paths", () => {
    it("skips session resolution for /v1/* and /api/health", async () => {
      const ingest = createEvent(`${ORIGIN}/v1/logs`, { method: "POST" });
      const health = createEvent(`${ORIGIN}/api/health`);
      await handle({ event: ingest, resolve });
      await handle({ event: health, resolve });

      expect(mocks.getSession).not.toHaveBeenCalled();
      expect(resolve).toHaveBeenCalledWith(ingest);
      expect(resolve).toHaveBeenCalledWith(health);
      expect(ingest.locals.db).toBe(mocks.db);
    });
  });

  describe("login rate limiting", () => {
    it("returns 429 with Retry-After: 60 once the limiter is exhausted", async () => {
      const address = "198.51.100.23";

      const signIn = () =>
        createEvent(
          `${ORIGIN}/api/auth/sign-in/username`,
          { method: "POST", headers: { Origin: ORIGIN } },
          address,
        );

      for (let i = 0; i < LOGIN_RPM; i++) {
        expect((await handle({ event: signIn(), resolve })).status).toBe(200);
      }

      expect(mocks.authHandler).toHaveBeenCalledTimes(LOGIN_RPM);

      const blocked = await handle({ event: signIn(), resolve });
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("Retry-After")).toBe("60");
      expect((await blocked.json()).error).toBe("rate_limited");
      expect(mocks.authHandler).toHaveBeenCalledTimes(LOGIN_RPM);
    });
  });

  describe("sign-up kill switch", () => {
    it("returns 403 sign_up_disabled for POST /api/auth/sign-up", async () => {
      const event = createEvent(`${ORIGIN}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { Origin: ORIGIN },
      });

      const response = await handle({ event, resolve });

      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe("sign_up_disabled");
      expect(mocks.authHandler).not.toHaveBeenCalled();
    });
  });

  describe("CSRF enforcement on /api/auth/*", () => {
    it("rejects a cross-origin non-GET request with csrf_error", async () => {
      const event = createEvent(`${ORIGIN}/api/auth/sign-out`, {
        method: "POST",
        headers: { Origin: "https://evil.example" },
      });

      const response = await handle({ event, resolve });

      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe("csrf_error");
      expect(mocks.authHandler).not.toHaveBeenCalled();
    });

    it("rejects a non-GET request carrying neither Origin nor Referer", async () => {
      const event = createEvent(`${ORIGIN}/api/auth/sign-out`, { method: "POST" });
      const response = await handle({ event, resolve });

      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe("csrf_error");
    });

    it("delegates same-origin auth routes to the better-auth handler", async () => {
      const event = createEvent(`${ORIGIN}/api/auth/get-session`, {
        headers: { Origin: ORIGIN },
      });

      const response = await handle({ event, resolve });

      expect(await response.text()).toBe("auth-handler");
      expect(resolve).not.toHaveBeenCalled();
    });
  });

  describe("pre-auth /v1 rate limiting", () => {
    const INGEST_IP_RPM = 2;

    it("returns 429 with Retry-After: 60 once the per-IP bucket is exhausted", async () => {
      mocks.env.RATE_LIMIT_INGEST_IP_RPM = INGEST_IP_RPM;
      const address = "198.51.100.31";
      const ingest = () => createEvent(`${ORIGIN}/v1/ingest`, { method: "POST" }, address);

      for (let i = 0; i < INGEST_IP_RPM; i++) {
        const allowed = await handle({ event: ingest(), resolve });
        expect(allowed.status).toBe(200);
        expect(await allowed.text()).toBe("resolved");
      }

      const blocked = await handle({ event: ingest(), resolve });
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("Retry-After")).toBe("60");
      expect((await blocked.json()).error).toBe("rate_limited");
      // The rejected request never reaches the route, and no session was resolved.
      expect(resolve).toHaveBeenCalledTimes(INGEST_IP_RPM);
      expect(mocks.getSession).not.toHaveBeenCalled();
    });

    it("does not share the login bucket for the same address", async () => {
      const address = "198.51.100.32";

      const signIn = () =>
        createEvent(
          `${ORIGIN}/api/auth/sign-in/username`,
          { method: "POST", headers: { Origin: ORIGIN } },
          address,
        );

      for (let i = 0; i < LOGIN_RPM; i++) {
        await handle({ event: signIn(), resolve });
      }

      expect((await handle({ event: signIn(), resolve })).status).toBe(429);

      const ingest = await handle({
        event: createEvent(`${ORIGIN}/v1/ingest`, { method: "POST" }, address),
        resolve,
      });

      expect(ingest.status).toBe(200);
    });
  });

  describe("CSRF with ORIGIN unset", () => {
    afterEach(() => vi.restoreAllMocks());

    it("accepts a same-host http Origin although the adapter synthesizes https", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      mocks.env.ORIGIN = undefined;

      const event = createEvent("https://localhost:3000/api/auth/sign-out", {
        method: "POST",
        headers: { Origin: "http://localhost:3000" },
      });

      const response = await handle({ event, resolve });

      // Past CSRF: the mocked better-auth baseURL origin differs from the synthesized
      // URL, so the request falls through to the app rather than the auth handler.
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("resolved");
      expect(warn).toHaveBeenCalled();
      expect(warn.mock.calls[0]?.[0]).toContain("ORIGIN is not set");
    });
  });
});
