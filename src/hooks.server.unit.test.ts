import type { RequestEvent } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { handleError as buildErrorResponse } from "#lib/server/error-handler.js";
import { LOGIN_ACCOUNT_RPM, LOGIN_RPM } from "./lib/server/utils/rate-limit";
import { handle, handleError } from "./hooks.server";

// SAFETY: beforeEach assigns ORIGIN a concrete origin string and the unset-origin test
// assigns undefined, so the field's type must widen past the undefined literal.
const mocks = vi.hoisted(() => ({
  db: { kind: "test-db" },
  closeDb: vi.fn(async () => {}),
  stopCleanupScheduler: vi.fn(),
  getSession: vi.fn(),
  authHandler: vi.fn(),
  // RATE_LIMIT_INGEST_IP_RPM is overridden in the /v1 throttle tests; the shipped
  // default is 60000/min, too high to reach in a unit test.
  env: { ORIGIN: undefined as string | undefined, RATE_LIMIT_INGEST_IP_RPM: 3 },
}));

vi.mock("$app/env", () => ({ building: false }));

vi.mock("#lib/server/db/index.js", () => ({ db: mocks.db, closeDb: mocks.closeDb }));

vi.mock("#lib/server/config/env.js", () => ({ env: mocks.env }));

vi.mock("#lib/server/auth.js", () => ({
  initAuth: vi.fn(),
  auth: {
    options: { baseURL: "http://localhost", basePath: "/api/auth" },
    api: { getSession: mocks.getSession },
    handler: mocks.authHandler,
  },
}));

vi.mock("#lib/server/error-handler.js", () => ({ handleError: vi.fn() }));

vi.mock("#lib/server/jobs/cleanup-scheduler.js", () => ({
  startCleanupScheduler: vi.fn(),
  stopCleanupScheduler: mocks.stopCleanupScheduler,
}));

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

  // SAFETY: handle, handleError, checkCsrfOrigin and better-auth's svelteKitHandler read only
  // request, url, locals, route and getClientAddress from the event — all set above — so the
  // omitted members (cookies, fetch, tracing, setHeaders, platform, …) are never accessed.
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

  describe("login rate limiting by network and account", () => {
    const signInAs = (username: string, address: string) =>
      createEvent(
        `${ORIGIN}/api/auth/sign-in/username`,
        {
          method: "POST",
          headers: { Origin: ORIGIN, "Content-Type": "application/json" },
          body: JSON.stringify({ username, password: "guess" }),
        },
        address,
      );

    // One fresh IPv4 address per attempt, so only the account bucket can trip.
    const freshAddress = (() => {
      let next = 0;

      return () => {
        next += 1;

        return `10.${Math.floor(next / 250)}.${next % 250}.1`;
      };
    })();

    it("shares one bucket across every address in an IPv6 /64", async () => {
      for (let i = 0; i < LOGIN_RPM; i++) {
        const event = createEvent(
          `${ORIGIN}/api/auth/sign-in/username`,
          { method: "POST", headers: { Origin: ORIGIN } },
          `2001:db8:77:1::${(i + 1).toString(16)}`,
        );

        expect((await handle({ event, resolve })).status).toBe(200);
      }

      const rotated = createEvent(
        `${ORIGIN}/api/auth/sign-in/username`,
        { method: "POST", headers: { Origin: ORIGIN } },
        "2001:db8:77:1:ffff:ffff:ffff:fffe",
      );

      expect((await handle({ event: rotated, resolve })).status).toBe(429);
    });

    it("blocks an account after LOGIN_ACCOUNT_RPM failed attempts from any address", async () => {
      mocks.authHandler.mockImplementation(() => new Response("bad credentials", { status: 401 }));

      for (let i = 0; i < LOGIN_ACCOUNT_RPM; i++) {
        const response = await handle({ event: signInAs("Victim", freshAddress()), resolve });
        expect(response.status).toBe(401);
      }

      // Username matching is case- and whitespace-insensitive, like the username plugin's.
      const blocked = await handle({ event: signInAs("  victim ", freshAddress()), resolve });
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("Retry-After")).toBe("60");
      expect(mocks.authHandler).toHaveBeenCalledTimes(LOGIN_ACCOUNT_RPM);

      // Other accounts are unaffected.
      expect((await handle({ event: signInAs("bystander", freshAddress()), resolve })).status).toBe(
        401,
      );
    });

    it("does not count successful sign-ins against the account", async () => {
      for (let i = 0; i < LOGIN_ACCOUNT_RPM + 5; i++) {
        const response = await handle({ event: signInAs("regular", freshAddress()), resolve });
        expect(response.status).toBe(200);
      }
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
    // Both rows drive the real handle() path; the exhaustive header matrix lives in
    // tests/integration/utils/csrf.integration.test.ts.
    const cases: [string, RequestInit][] = [
      ["cross-origin Origin", { method: "POST", headers: { Origin: "https://evil.example" } }],
      ["neither Origin nor Referer", { method: "POST" }],
    ];

    it.each(cases)("rejects a non-GET request with csrf_error (%s)", async (_scenario, init) => {
      const event = createEvent(`${ORIGIN}/api/auth/sign-out`, init);

      const response = await handle({ event, resolve });

      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe("csrf_error");
      expect(mocks.authHandler).not.toHaveBeenCalled();
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

  describe("graceful shutdown", () => {
    it("stops the scheduler and closes the DB pool on sveltekit:shutdown", async () => {
      // Fake timers keep the unref'd process.exit fallback from firing in the worker.
      vi.useFakeTimers();
      vi.spyOn(console, "log").mockImplementation(() => {});

      try {
        // The hook registers with process.once, so this event fires it exactly once per module.
        process.emit("sveltekit:shutdown", "SIGTERM");
        expect(mocks.stopCleanupScheduler).toHaveBeenCalledTimes(1);
        expect(mocks.closeDb).toHaveBeenCalledTimes(1);
      } finally {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
      }
    });
  });
});

describe("hooks.server handleError", () => {
  const event = createEvent("http://localhost/projects/missing");

  beforeEach(() => {
    vi.mocked(buildErrorResponse)
      .mockReset()
      .mockReturnValue({ id: "err_1", message: "sanitized" });
  });

  it("keeps the body of an error() throw without logging it", async () => {
    const result = await handleError({
      kind: "app",
      error: { status: 404, message: "Project not found" },
      event,
    });

    expect(result).toBeUndefined();
    expect(buildErrorResponse).not.toHaveBeenCalled();
  });

  it("logs a framework error with its own status and message", async () => {
    const result = await handleError({
      kind: "framework",
      error: { status: 404, message: "Not Found" },
      event,
    });

    expect(result).toEqual({ id: "err_1", message: "sanitized" });
    expect(buildErrorResponse).toHaveBeenCalledWith(
      expect.objectContaining({ status: 404, message: "Not Found", route: "unknown" }),
    );
  });

  it("logs an unknown throw as a 500 with the original error attached", async () => {
    const thrown = new Error("db exploded");

    await handleError({ kind: "unknown", error: thrown, event });

    expect(buildErrorResponse).toHaveBeenCalledWith(
      expect.objectContaining({ error: thrown, status: 500, message: "Internal Error" }),
    );
  });
});
