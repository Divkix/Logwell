import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
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
    const response = await GET({
      locals: {
        db: {
          execute: () => {
            throw new Error("Connection refused");
          },
        },
      },
      request: new Request("http://localhost/api/health"),
      url: new URL("http://localhost/api/health"),
      params: {},
    } as unknown as Parameters<typeof GET>[0]);

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.status).toBe("unhealthy");
    expect(body.database).toBe("disconnected");
  });
});
