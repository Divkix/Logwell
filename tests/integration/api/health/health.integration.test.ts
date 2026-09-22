import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { setupTestDatabase } from "$lib/server/db/test-db";
import { GET } from "../../../../src/routes/api/health/+server";

describe("GET /api/health", () => {
  let db: Awaited<ReturnType<typeof setupTestDatabase>>["db"];
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("returns 200 with a healthy payload when the database is reachable", async () => {
    // SAFETY: GET reads only event.locals via getDbClient, and locals.db is the real test PgliteDatabase from setupTestDatabase; no other RequestEvent field is accessed.
    const response = await GET({
      locals: { db },
      request: new Request("http://localhost/api/health"),
      url: new URL("http://localhost/api/health"),
      params: {},
    } as Parameters<typeof GET>[0]);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("healthy");
    expect(body.database).toBe("connected");
  });

  it("returns 503 when the database is unreachable", async () => {
    const execute = vi.spyOn(db, "execute").mockImplementation(() => {
      throw new Error("Connection refused");
    });

    // SAFETY: GET reads only event.locals via getDbClient; locals.db is the real test PgliteDatabase whose execute the spy makes always throw — exactly the call checkDatabase awaits. No other RequestEvent field is accessed.
    const response = await GET({
      locals: { db },
      request: new Request("http://localhost/api/health"),
      url: new URL("http://localhost/api/health"),
      params: {},
    } as Parameters<typeof GET>[0]);

    execute.mockRestore();

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.status).toBe("unhealthy");
    expect(body.database).toBe("disconnected");
  });
});
