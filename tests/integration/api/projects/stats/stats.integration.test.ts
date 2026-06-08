import type { HttpError } from "@sveltejs/kit";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createAuth } from "$lib/server/auth";
import type * as schema from "$lib/server/db/schema";
import { setupTestDatabase } from "$lib/server/db/test-db";
import { getSession } from "$lib/server/session";
import { clearApiKeyCache } from "$lib/server/utils/api-key";
import { GET } from "../../../../../src/routes/api/projects/[id]/stats/+server";
import { seedLogs, seedProject } from "../../../../fixtures/db";

/**
 * Helper to create a mock SvelteKit RequestEvent for [id]/stats routes
 */
function createRequestEvent(
  request: Request,
  db: PgliteDatabase<typeof schema>,
  params: { id: string },
  locals: Partial<App.Locals> = {},
) {
  return {
    request,
    locals: { db, ...locals },
    params,
    url: new URL(request.url),
    platform: undefined,
    route: { id: "/api/projects/[id]/stats" },
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

describe("GET /api/projects/[id]/stats", () => {
  let db: PgliteDatabase<typeof schema>;
  let cleanup: () => Promise<void>;
  let auth: ReturnType<typeof createAuth>;
  let authenticatedLocals: Partial<App.Locals>;
  let userId: string;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
    auth = createAuth(db);
    clearApiKeyCache();

    // Create authenticated user
    const signUpResult = await auth.api.signUpEmail({
      body: {
        email: "test@example.com",
        password: "SecureP@ssw0rd123",
        name: "Test User",
      },
    });

    const mockRequest = new Request("http://localhost:5173", {
      headers: {
        cookie: `better-auth.session_token=${signUpResult.token}`,
      },
    });

    const sessionData = await getSession(mockRequest.headers, db);
    if (!sessionData) throw new Error("Session data should not be null");
    userId = sessionData.user.id;

    authenticatedLocals = {
      user: sessionData.user,
      session: sessionData.session,
    };
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("Authentication", () => {
    it("returns 401 for unauthenticated request", async () => {
      const testProject = await seedProject(db, { ownerId: userId });
      const request = new Request(`http://localhost/api/projects/${testProject.id}/stats`, {
        method: "GET",
      });

      const event = createRequestEvent(request, db, { id: testProject.id });
      await expectHttpError(GET(event as never), 401, { message: "Unauthorized" });
    });
  });

  describe("Level Distribution Counts", () => {
    it("returns level distribution counts", async () => {
      const testProject = await seedProject(db, { ownerId: userId });

      // Seed logs with different levels
      await seedLogs(db, testProject.id, 10, { level: "debug" });
      await seedLogs(db, testProject.id, 25, { level: "info" });
      await seedLogs(db, testProject.id, 8, { level: "warn" });
      await seedLogs(db, testProject.id, 5, { level: "error" });
      await seedLogs(db, testProject.id, 2, { level: "fatal" });

      const request = new Request(`http://localhost/api/projects/${testProject.id}/stats`, {
        method: "GET",
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toHaveProperty("totalLogs", 50);
      expect(body).toHaveProperty("levelCounts");
      expect(body.levelCounts).toEqual({
        debug: 10,
        info: 25,
        warn: 8,
        error: 5,
        fatal: 2,
      });
    });

    it("returns only levels that have logs", async () => {
      const testProject = await seedProject(db, { ownerId: userId });

      // Only seed info and error logs
      await seedLogs(db, testProject.id, 15, { level: "info" });
      await seedLogs(db, testProject.id, 5, { level: "error" });

      const request = new Request(`http://localhost/api/projects/${testProject.id}/stats`, {
        method: "GET",
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body.levelCounts).toEqual({
        info: 15,
        error: 5,
      });
      // Should not include levels with zero counts
      expect(body.levelCounts).not.toHaveProperty("debug");
      expect(body.levelCounts).not.toHaveProperty("warn");
      expect(body.levelCounts).not.toHaveProperty("fatal");
    });
  });

  describe("Percentage Calculations", () => {
    it("calculates percentages correctly", async () => {
      const testProject = await seedProject(db, { ownerId: userId });

      // Total of 100 logs for easy percentage calculation
      await seedLogs(db, testProject.id, 50, { level: "info" }); // 50%
      await seedLogs(db, testProject.id, 30, { level: "warn" }); // 30%
      await seedLogs(db, testProject.id, 20, { level: "error" }); // 20%

      const request = new Request(`http://localhost/api/projects/${testProject.id}/stats`, {
        method: "GET",
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toHaveProperty("levelPercentages");
      expect(body.levelPercentages.info).toBeCloseTo(50, 1);
      expect(body.levelPercentages.warn).toBeCloseTo(30, 1);
      expect(body.levelPercentages.error).toBeCloseTo(20, 1);
    });

    it("handles percentages with decimal precision", async () => {
      const testProject = await seedProject(db, { ownerId: userId });

      // Total of 3 logs for fractional percentages
      await seedLogs(db, testProject.id, 1, { level: "info" }); // 33.33%
      await seedLogs(db, testProject.id, 1, { level: "warn" }); // 33.33%
      await seedLogs(db, testProject.id, 1, { level: "error" }); // 33.33%

      const request = new Request(`http://localhost/api/projects/${testProject.id}/stats`, {
        method: "GET",
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toHaveProperty("levelPercentages");
      // Each should be approximately 33.33%
      expect(body.levelPercentages.info).toBeCloseTo(33.33, 1);
      expect(body.levelPercentages.warn).toBeCloseTo(33.33, 1);
      expect(body.levelPercentages.error).toBeCloseTo(33.33, 1);
    });

    it("percentages sum to approximately 100", async () => {
      const testProject = await seedProject(db, { ownerId: userId });

      await seedLogs(db, testProject.id, 7, { level: "debug" });
      await seedLogs(db, testProject.id, 13, { level: "info" });
      await seedLogs(db, testProject.id, 5, { level: "warn" });
      await seedLogs(db, testProject.id, 3, { level: "error" });
      await seedLogs(db, testProject.id, 2, { level: "fatal" });

      const request = new Request(`http://localhost/api/projects/${testProject.id}/stats`, {
        method: "GET",
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      const totalPercentage = Object.values(body.levelPercentages as Record<string, number>).reduce(
        (sum, pct) => sum + pct,
        0,
      );
      expect(totalPercentage).toBeCloseTo(100, 0);
    });
  });

  describe("Time Range Parameters", () => {
    it("respects from timestamp parameter", async () => {
      const testProject = await seedProject(db, { ownerId: userId });

      const now = new Date();
      // Old logs (before the 'from' filter - should be excluded)
      await seedLogs(db, testProject.id, 10, {
        level: "info",
        timestamp: new Date(now.getTime() - 7200000), // 2 hours ago
      });
      // Recent logs (after the 'from' filter - should be included)
      await seedLogs(db, testProject.id, 5, {
        level: "error",
        timestamp: new Date(now.getTime() - 60000), // 1 minute ago
      });

      // Filter for logs from 1 hour ago
      const fromTime = new Date(now.getTime() - 3600000).toISOString();
      const request = new Request(
        `http://localhost/api/projects/${testProject.id}/stats?from=${fromTime}`,
        { method: "GET" },
      );

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      // Should only count the 5 recent error logs
      expect(body.totalLogs).toBe(5);
      expect(body.levelCounts).toEqual({ error: 5 });
    });

    it("respects to timestamp parameter", async () => {
      const testProject = await seedProject(db, { ownerId: userId });

      const now = new Date();
      // Old logs (before the 'to' filter - should be included)
      await seedLogs(db, testProject.id, 8, {
        level: "warn",
        timestamp: new Date(now.getTime() - 7200000), // 2 hours ago
      });
      // Recent logs (after the 'to' filter - should be excluded)
      await seedLogs(db, testProject.id, 12, {
        level: "info",
        timestamp: new Date(now.getTime() - 60000), // 1 minute ago
      });

      // Filter for logs up to 1 hour ago
      const toTime = new Date(now.getTime() - 3600000).toISOString();
      const request = new Request(
        `http://localhost/api/projects/${testProject.id}/stats?to=${toTime}`,
        { method: "GET" },
      );

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      // Should only count the 8 old warn logs
      expect(body.totalLogs).toBe(8);
      expect(body.levelCounts).toEqual({ warn: 8 });
    });

    it("respects both from and to timestamp parameters", async () => {
      const testProject = await seedProject(db, { ownerId: userId });

      const now = new Date();
      // Very old logs (before the 'from' - should be excluded)
      await seedLogs(db, testProject.id, 5, {
        level: "debug",
        timestamp: new Date(now.getTime() - 14400000), // 4 hours ago
      });
      // Middle logs (within range - should be included)
      await seedLogs(db, testProject.id, 10, {
        level: "info",
        timestamp: new Date(now.getTime() - 5400000), // 1.5 hours ago
      });
      await seedLogs(db, testProject.id, 3, {
        level: "error",
        timestamp: new Date(now.getTime() - 5400000), // 1.5 hours ago
      });
      // Recent logs (after 'to' - should be excluded)
      await seedLogs(db, testProject.id, 7, {
        level: "fatal",
        timestamp: new Date(now.getTime() - 60000), // 1 minute ago
      });

      // Filter for logs between 2 hours ago and 1 hour ago
      const fromTime = new Date(now.getTime() - 7200000).toISOString();
      const toTime = new Date(now.getTime() - 3600000).toISOString();
      const request = new Request(
        `http://localhost/api/projects/${testProject.id}/stats?from=${fromTime}&to=${toTime}`,
        { method: "GET" },
      );

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      // Should only count the 13 middle logs (10 info + 3 error)
      expect(body.totalLogs).toBe(13);
      expect(body.levelCounts).toEqual({ info: 10, error: 3 });
    });
  });

  describe("Project Validation", () => {
    it("returns 404 for non-existent project", async () => {
      const request = new Request("http://localhost/api/projects/non-existent-id/stats", {
        method: "GET",
      });

      const event = createRequestEvent(request, db, { id: "non-existent-id" }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body).toHaveProperty("error", "not_found");
      expect(body).toHaveProperty("message", "Project not found");
    });
  });

  describe("Empty State", () => {
    it("returns zero counts when project has no logs", async () => {
      const testProject = await seedProject(db, { ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${testProject.id}/stats`, {
        method: "GET",
      });

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body.totalLogs).toBe(0);
      expect(body.levelCounts).toEqual({});
      expect(body.levelPercentages).toEqual({});
    });

    it("returns zero counts when time range has no logs", async () => {
      const testProject = await seedProject(db, { ownerId: userId });

      const now = new Date();
      // All logs are old
      await seedLogs(db, testProject.id, 10, {
        level: "info",
        timestamp: new Date(now.getTime() - 7200000), // 2 hours ago
      });

      // Filter for last 30 minutes (no logs in this range)
      const fromTime = new Date(now.getTime() - 1800000).toISOString();
      const request = new Request(
        `http://localhost/api/projects/${testProject.id}/stats?from=${fromTime}`,
        { method: "GET" },
      );

      const event = createRequestEvent(request, db, { id: testProject.id }, authenticatedLocals);
      const response = await GET(event as never);

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body.totalLogs).toBe(0);
      expect(body.levelCounts).toEqual({});
      expect(body.levelPercentages).toEqual({});
    });
  });
});
