import type { PgliteDatabase } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type * as schema from "../../../../../../../src/lib/server/db/schema";
import { type Incident, user } from "../../../../../../../src/lib/server/db/schema";
import { setupTestDatabase } from "../../../../../../../src/lib/server/db/test-db";
import { logEventBus } from "../../../../../../../src/lib/server/events";
import { seedProject } from "../../../../../../fixtures/db";

/**
 * Helper to create a mock SvelteKit RequestEvent for the incidents SSE endpoint.
 * Adds a same-origin Origin header to state-changing requests so they pass CSRF checks.
 */
function createRequestEvent(
  request: Request,
  db: PgliteDatabase<typeof schema>,
  params: { id: string },
  authenticated = true,
) {
  const safeMethod = ["GET", "HEAD", "OPTIONS"].includes(request.method);
  const hasOrigin = request.headers.has("Origin");
  const effectiveRequest =
    !safeMethod && !hasOrigin
      ? new Request(request, {
          headers: { ...Object.fromEntries(request.headers), Origin: new URL(request.url).origin },
        })
      : request;
  return {
    request: effectiveRequest,
    locals: {
      db,
      user: authenticated ? { id: "test-user-id", email: "admin@test.com" } : null,
      session: authenticated ? { id: "test-session-id", expiresAt: new Date() } : null,
    },
    params,
    url: new URL(request.url),
    platform: undefined,
    route: { id: "/api/projects/[id]/incidents/stream" },
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
 * Helper to parse SSE events from a stream.
 * Returns an async iterator of parsed events.
 */
async function* parseSSEStream(
  response: Response,
): AsyncGenerator<{ event: string; data: string }> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse complete events from buffer
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      let currentEvent = "";
      let currentData = "";

      for (const line of lines) {
        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          currentData = line.slice(5).trim();
        } else if (line === "" && currentEvent && currentData) {
          yield { event: currentEvent, data: currentData };
          currentEvent = "";
          currentData = "";
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Helper to collect N events from SSE stream with timeout.
 */
async function collectSSEEvents(
  response: Response,
  count: number,
  timeoutMs = 5000,
): Promise<Array<{ event: string; data: string }>> {
  const events: Array<{ event: string; data: string }> = [];
  const stream = parseSSEStream(response);

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;

  const timeoutPromise = new Promise<void>((resolve) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      resolve();
    }, timeoutMs);
  });

  const collectPromise = (async () => {
    try {
      for await (const event of stream) {
        if (timedOut) break;
        events.push(event);
        if (events.length >= count) break;
      }
    } catch {
      // Stream closed or error — return what we have
    }
  })();

  await Promise.race([collectPromise, timeoutPromise]);

  if (timeoutId) {
    clearTimeout(timeoutId);
  }

  return events;
}

/**
 * Create a mock Incident object for testing.
 */
function createMockIncident(projectId: string, overrides: Partial<Incident> = {}): Incident {
  return {
    id: `inc_${Math.random().toString(36).slice(2, 10)}`,
    projectId,
    fingerprint: `fp_${Math.random().toString(36).slice(2, 10)}`,
    title: "Test incident",
    normalizedMessage: "Test normalized message",
    serviceName: null,
    sourceFile: null,
    lineNumber: null,
    highestLevel: "error",
    firstSeen: new Date(),
    lastSeen: new Date(),
    totalEvents: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("POST /api/projects/[id]/incidents/stream", () => {
  let db: PgliteDatabase<typeof schema>;
  let cleanup: () => Promise<void>;
  let userId: string;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
    logEventBus.clear();
    // Create the test user in the database (matches the mock in createRequestEvent)
    userId = "test-user-id";
    await db.insert(user).values({
      id: userId,
      name: "Test User",
      email: "admin@test.com",
      emailVerified: false,
    });
  });

  afterEach(async () => {
    logEventBus.clear();
    await cleanup();
  });

  describe("Authentication & Authorization", () => {
    it("returns 401 when not authenticated", async () => {
      const project = await seedProject(db, { ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${project.id}/incidents/stream`, {
        method: "POST",
      });

      const event = createRequestEvent(request, db, { id: project.id }, false);

      const { POST } =
        await import("../../../../../../../src/routes/api/projects/[id]/incidents/stream/+server");

      try {
        await POST(event as never);
        expect.fail("Should have thrown HTTP error");
      } catch (e) {
        expect(e).toHaveProperty("status", 401);
        expect(e).toHaveProperty("body", { message: "Unauthorized" });
      }
    });

    it("returns 404 for a project owned by a different user (cross-tenant IDOR guard)", async () => {
      // Seed a second user who owns the project
      const otherUserId = "other-user-id";
      await db.insert(user).values({
        id: otherUserId,
        name: "Other User",
        email: "other@test.com",
        emailVerified: false,
      });

      // Seed a project owned by otherUser — it EXISTS but is not owned by the test user
      const otherProject = await seedProject(db, { ownerId: otherUserId });

      const request = new Request(
        `http://localhost/api/projects/${otherProject.id}/incidents/stream`,
        { method: "POST" },
      );

      // Call as the authenticated test user (not the owner)
      const event = createRequestEvent(request, db, { id: otherProject.id }, true);

      const { POST } =
        await import("../../../../../../../src/routes/api/projects/[id]/incidents/stream/+server");
      const response = await POST(event as never);

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toBe("not_found");
    });
  });

  describe("CSRF", () => {
    it("returns 403 for a request with a mismatched Origin header", async () => {
      const project = await seedProject(db, { ownerId: userId });

      // Build request with a cross-origin Origin header — do NOT let createRequestEvent
      // overwrite it, so pass a Request that already has the header set.
      const request = new Request(`http://localhost/api/projects/${project.id}/incidents/stream`, {
        method: "POST",
        headers: {
          Origin: "https://evil.com",
        },
      });

      // Pass the request directly into the mock event without Origin injection
      const event = {
        request,
        locals: {
          db,
          user: { id: userId, email: "admin@test.com" },
          session: { id: "test-session-id", expiresAt: new Date() },
        },
        params: { id: project.id },
        url: new URL(request.url),
        platform: undefined,
        route: { id: "/api/projects/[id]/incidents/stream" },
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
      };

      const { POST } =
        await import("../../../../../../../src/routes/api/projects/[id]/incidents/stream/+server");
      const response = await POST(event as never);

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe("csrf_error");
    });
  });

  describe("SSE Response Format", () => {
    it("returns correct SSE headers and 200 status", async () => {
      const project = await seedProject(db, { ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${project.id}/incidents/stream`, {
        method: "POST",
      });

      const event = createRequestEvent(request, db, { id: project.id }, true);

      const { POST } =
        await import("../../../../../../../src/routes/api/projects/[id]/incidents/stream/+server");
      const response = await POST(event as never);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/event-stream");
      expect(response.headers.get("Cache-Control")).toBe("no-cache");
      expect(response.headers.get("Connection")).toBe("keep-alive");
    });
  });

  describe("Incident streaming", () => {
    it("delivers incidents when event bus fires", async () => {
      const project = await seedProject(db, { ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${project.id}/incidents/stream`, {
        method: "POST",
      });

      const event = createRequestEvent(request, db, { id: project.id }, true);

      const { POST } =
        await import("../../../../../../../src/routes/api/projects/[id]/incidents/stream/+server");
      const response = await POST(event as never);

      // Give SSE time to set up subscription
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Emit an incident to the event bus
      const mockIncident = createMockIncident(project.id, { title: "Test incident" });
      logEventBus.emitIncident(mockIncident);

      // Collect events from the stream
      const events = await collectSSEEvents(response, 1, 3000);

      expect(events.length).toBeGreaterThanOrEqual(1);

      // Find the incidents event (not heartbeat)
      const incidentsEvent = events.find((e) => e.event === "incidents");
      expect(incidentsEvent).toBeDefined();
      if (!incidentsEvent) throw new Error("Expected incidentsEvent to be defined");

      const incidents = JSON.parse(incidentsEvent.data);
      expect(Array.isArray(incidents)).toBe(true);
      expect(incidents.some((inc: Incident) => inc.title === "Test incident")).toBe(true);
    });

    it("only receives incidents for the subscribed project (isolation)", async () => {
      const project1 = await seedProject(db, { ownerId: userId });
      const project2 = await seedProject(db, { ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${project1.id}/incidents/stream`, {
        method: "POST",
      });

      const event = createRequestEvent(request, db, { id: project1.id }, true);

      const { POST } =
        await import("../../../../../../../src/routes/api/projects/[id]/incidents/stream/+server");
      const response = await POST(event as never);

      // Give SSE time to set up subscription
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Emit incident to a different project (should not arrive)
      const otherIncident = createMockIncident(project2.id, { title: "Other project incident" });
      logEventBus.emitIncident(otherIncident);

      // Emit incident to the subscribed project (should arrive)
      const subscribedIncident = createMockIncident(project1.id, {
        title: "Subscribed project incident",
      });
      logEventBus.emitIncident(subscribedIncident);

      // Collect events
      const events = await collectSSEEvents(response, 1, 3000);

      const incidentsEvent = events.find((e) => e.event === "incidents");
      if (incidentsEvent) {
        const incidents = JSON.parse(incidentsEvent.data);
        // Should only contain incidents for project1
        expect(incidents.every((inc: Incident) => inc.projectId === project1.id)).toBe(true);
        expect(incidents.some((inc: Incident) => inc.title === "Subscribed project incident")).toBe(
          true,
        );
        expect(incidents.some((inc: Incident) => inc.title === "Other project incident")).toBe(
          false,
        );
      }
    });
  });

  describe("Cleanup", () => {
    it("removes incident listener from event bus on disconnect", async () => {
      const project = await seedProject(db, { ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${project.id}/incidents/stream`, {
        method: "POST",
      });

      const event = createRequestEvent(request, db, { id: project.id }, true);

      const { POST } =
        await import("../../../../../../../src/routes/api/projects/[id]/incidents/stream/+server");

      // Verify no listeners before connecting
      const initialCount = logEventBus.getIncidentListenerCount(project.id);
      expect(initialCount).toBe(0);

      const response = await POST(event as never);

      // Give SSE time to set up subscription
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify listener was added
      const connectedCount = logEventBus.getIncidentListenerCount(project.id);
      expect(connectedCount).toBe(1);

      // Cancel the stream to simulate disconnect
      const reader = response.body?.getReader();
      await reader?.cancel();

      // Give cleanup time to execute
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify listener was removed
      const finalCount = logEventBus.getIncidentListenerCount(project.id);
      expect(finalCount).toBe(0);
    });
  });
});
