import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as schema from "$lib/server/db/schema";
import { GET } from "../../../../src/routes/api/health/+server";

describe("Health Check Endpoint", () => {
  let pglite: PGlite;
  let db: ReturnType<typeof drizzle>;
  let mockEvent: Parameters<typeof GET>[0];

  beforeEach(async () => {
    // Create in-memory PGlite database for testing
    pglite = new PGlite();
    db = drizzle(pglite, { schema });

    // Run migrations
    await pglite.exec(`
      CREATE TABLE IF NOT EXISTS project (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        api_key TEXT NOT NULL UNIQUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create mock event with database
    mockEvent = {
      locals: { db } as unknown as App.Locals,
      request: new Request("http://localhost/api/health"),
      url: new URL("http://localhost/api/health"),
      params: {},
    } as Parameters<typeof GET>[0];
  });

  afterEach(async () => {
    await pglite.close();
    vi.restoreAllMocks();
  });

  describe("GET /api/health", () => {
    it("returns 200 OK when database is healthy", async () => {
      const response = await GET(mockEvent);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe("healthy");
    });

    it("returns database status as connected", async () => {
      const response = await GET(mockEvent);

      const body = await response.json();
      expect(body.database).toBe("connected");
    });

    it("returns timestamp in response", async () => {
      const response = await GET(mockEvent);

      const body = await response.json();
      expect(body.timestamp).toBeDefined();
      expect(new Date(body.timestamp).getTime()).not.toBeNaN();
    });

    it("returns uptime in response", async () => {
      const response = await GET(mockEvent);

      const body = await response.json();
      expect(typeof body.uptime).toBe("number");
      expect(body.uptime).toBeGreaterThanOrEqual(0);
    });

    it("returns version in response", async () => {
      const response = await GET(mockEvent);

      const body = await response.json();
      expect(body.version).toBeDefined();
      expect(typeof body.version).toBe("string");
    });

    it("returns correct content-type header", async () => {
      const response = await GET(mockEvent);

      expect(response.headers.get("content-type")).toContain("application/json");
    });

    it("returns cache-control header to prevent caching", async () => {
      const response = await GET(mockEvent);

      expect(response.headers.get("cache-control")).toBe("no-cache, no-store, must-revalidate");
    });
  });

  describe("GET /api/health - unhealthy states", () => {
    it("returns 503 when database connection fails", async () => {
      // Create new event without valid db (simulating connection failure)
      const failingEvent = {
        ...mockEvent,
        locals: { db: null } as unknown as App.Locals,
      } as Parameters<typeof GET>[0];

      const response = await GET(failingEvent);

      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.status).toBe("unhealthy");
      expect(body.database).toBe("disconnected");
    });

    it("includes error message when database check fails", async () => {
      // Create event with broken db mock
      const brokenDb = {
        execute: () => {
          throw new Error("Connection refused");
        },
      };

      const failingEvent = {
        ...mockEvent,
        locals: { db: brokenDb } as unknown as App.Locals,
      } as Parameters<typeof GET>[0];

      const response = await GET(failingEvent);

      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.error).toBeDefined();
    });
  });

  describe("Health check response format", () => {
    it("matches expected schema structure", async () => {
      const response = await GET(mockEvent);
      const body = await response.json();

      // Verify all expected fields exist
      expect(body).toHaveProperty("status");
      expect(body).toHaveProperty("database");
      expect(body).toHaveProperty("timestamp");
      expect(body).toHaveProperty("uptime");
      expect(body).toHaveProperty("version");
    });

    it("status is one of healthy or unhealthy", async () => {
      const response = await GET(mockEvent);
      const body = await response.json();

      expect(["healthy", "unhealthy"]).toContain(body.status);
    });

    it("database is one of connected or disconnected", async () => {
      const response = await GET(mockEvent);
      const body = await response.json();

      expect(["connected", "disconnected"]).toContain(body.database);
    });
  });
});
