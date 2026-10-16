import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { getHealthDbClient } from "#lib/server/db/db.js";
import { setupTestDatabase } from "#lib/server/db/test-db.js";
import { GET } from "../../../../src/routes/api/health/+server";

type HealthEvent = Parameters<typeof GET>[0];

describe("GET /api/health", () => {
  let db: Awaited<ReturnType<typeof setupTestDatabase>>["db"];
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await cleanup();
  });

  function healthEvent(): HealthEvent {
    // SAFETY: GET reads only event.locals via getHealthDbClient, and locals.db is the real test PgliteDatabase from setupTestDatabase; no other RequestEvent field is accessed.
    return {
      locals: { db },
      request: new Request("http://localhost/api/health"),
      url: new URL("http://localhost/api/health"),
      params: {},
    } as HealthEvent;
  }

  it("returns 200 with a healthy payload when the database is reachable", async () => {
    const response = await GET(healthEvent());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("healthy");
    expect(body.database).toBe("connected");
  });

  it("does not disclose the app version on the public endpoint", async () => {
    const body = await (await GET(healthEvent())).json();

    expect(body).not.toHaveProperty("version");
    expect(Object.keys(body).sort()).toEqual(["database", "status", "timestamp", "uptime"]);
  });

  it("returns 503 when the database is unreachable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(db, "execute").mockImplementation(() => {
      throw new Error("Connection refused");
    });

    const response = await GET(healthEvent());

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.status).toBe("unhealthy");
    expect(body.database).toBe("disconnected");
  });

  it("answers 503 within its deadline when the probe hangs", async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    // SAFETY: a never-settling promise stands in for a query stuck behind a saturated pool; checkDatabase only awaits it.
    vi.spyOn(db, "execute").mockReturnValue(new Promise(() => {}) as never);

    const pending = GET(healthEvent());
    await vi.advanceTimersByTimeAsync(3000);
    const response = await pending;

    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("database unavailable");
    expect(String(consoleError.mock.calls[0]?.[1])).toContain("timed out");
  });
});

describe("getHealthDbClient", () => {
  it("probes over the dedicated health connection, not the shared app pool", async () => {
    const pool = await import("#lib/server/db/index.js");

    // hooks.server.ts injects the shared pool on every request; health must not queue behind it.
    await expect(getHealthDbClient({ db: pool.db })).resolves.toBe(pool.healthDb);
    await expect(getHealthDbClient({})).resolves.toBe(pool.healthDb);
    expect(pool.healthDb).not.toBe(pool.db);
  });

  it("keeps a test-injected client", async () => {
    const { db, cleanup } = await setupTestDatabase();

    try {
      await expect(getHealthDbClient({ db })).resolves.toBe(db);
    } finally {
      await cleanup();
    }
  });
});
