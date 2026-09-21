import type { PgliteDatabase } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { SSE_CONFIG } from "../../../../../../../src/lib/server/config/performance";
import type * as schema from "../../../../../../../src/lib/server/db/schema";
import { type Log, user } from "../../../../../../../src/lib/server/db/schema";
import { setupTestDatabase } from "../../../../../../../src/lib/server/db/test-db";
import { logEventBus } from "../../../../../../../src/lib/server/events";
import { seedProject } from "../../../../../../fixtures/db";

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
    route: { id: "/api/projects/[id]/logs/stream" },
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

async function collectSSEEvents(
  response: Response,
  count: number,
  timeoutMs = 5000,
): Promise<Array<{ event: string; data: string }>> {
  const events: Array<{ event: string; data: string }> = [];
  const stream = parseSSEStream(response);

  let timedOut = false;
  let cancelTimeout = () => {};

  // Failure bound only: the batch window that produces events is a real server-side timer.
  const timeoutPromise = new Promise<void>((resolve) => {
    const id = setTimeout(() => {
      timedOut = true;
      resolve();
    }, timeoutMs);
    cancelTimeout = () => clearTimeout(id);
  });

  const collectPromise = (async () => {
    for await (const event of stream) {
      if (timedOut) break;
      events.push(event);
      if (events.length >= count) break;
    }
  })();

  try {
    await Promise.race([collectPromise, timeoutPromise]);
  } finally {
    cancelTimeout();
  }

  return events;
}

function createMockLog(projectId: string, overrides: Partial<Log> = {}): Log {
  return {
    id: `log_${Math.random().toString(36).slice(2, 10)}`,
    projectId,
    incidentId: null,
    fingerprint: null,
    serviceName: null,
    level: "info",
    message: "Test log message",
    metadata: null,
    timeUnixNano: null,
    observedTimeUnixNano: null,
    severityNumber: null,
    severityText: null,
    body: null,
    droppedAttributesCount: null,
    flags: null,
    traceId: null,
    spanId: null,
    resourceAttributes: null,
    resourceDroppedAttributesCount: null,
    resourceSchemaUrl: null,
    scopeName: null,
    scopeVersion: null,
    scopeAttributes: null,
    scopeDroppedAttributesCount: null,
    scopeSchemaUrl: null,
    sourceFile: null,
    lineNumber: null,
    requestId: null,
    userId: null,
    ipAddress: null,
    timestamp: new Date(),
    search: "",
    ...overrides,
  };
}

describe("POST /api/projects/[id]/logs/stream", () => {
  let db: PgliteDatabase<typeof schema>;
  let cleanup: () => Promise<void>;
  let userId: string;

  beforeEach(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
    logEventBus.clear();
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

      const request = new Request(`http://localhost/api/projects/${project.id}/logs/stream`, {
        method: "POST",
      });

      const event = createRequestEvent(request, db, { id: project.id }, false);

      const { POST } =
        await import("../../../../../../../src/routes/api/projects/[id]/logs/stream/+server");

      try {
        await POST(event as never);
        expect.fail("Should have thrown HTTP error");
      } catch (e) {
        expect(e).toHaveProperty("status", 401);
        expect(e).toHaveProperty("body", { message: "Unauthorized" });
      }
    });

    it("returns 404 for non-existent project", async () => {
      const request = new Request("http://localhost/api/projects/non_existent_id/logs/stream", {
        method: "POST",
      });

      const event = createRequestEvent(request, db, { id: "non_existent_id" }, true);

      const { POST } =
        await import("../../../../../../../src/routes/api/projects/[id]/logs/stream/+server");
      const response = await POST(event as never);

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toBe("not_found");
    });
  });

  describe("SSE Response Format", () => {
    it("returns SSE content-type header", async () => {
      const project = await seedProject(db, { ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${project.id}/logs/stream`, {
        method: "POST",
      });

      const event = createRequestEvent(request, db, { id: project.id }, true);

      const { POST } =
        await import("../../../../../../../src/routes/api/projects/[id]/logs/stream/+server");
      const response = await POST(event as never);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/event-stream");
      expect(response.headers.get("Cache-Control")).toBe("no-cache");
      expect(response.headers.get("Connection")).toBe("keep-alive");
    });
  });

  describe("Log Streaming", () => {
    it("emits logs when event bus fires", async () => {
      const project = await seedProject(db, { ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${project.id}/logs/stream`, {
        method: "POST",
      });

      const event = createRequestEvent(request, db, { id: project.id }, true);

      const { POST } =
        await import("../../../../../../../src/routes/api/projects/[id]/logs/stream/+server");
      const response = await POST(event as never);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const mockLog = createMockLog(project.id, { message: "Test SSE log" });
      logEventBus.emitLog(mockLog);

      const events = await collectSSEEvents(response, 1, 3000);

      expect(events.length).toBeGreaterThanOrEqual(1);

      const logsEvent = events.find((e) => e.event === "logs");
      expect(logsEvent).toBeDefined();
      if (!logsEvent) throw new Error("Expected logsEvent to be defined");

      const logs = JSON.parse(logsEvent.data);
      expect(Array.isArray(logs)).toBe(true);
      expect(logs.some((l: Log) => l.message === "Test SSE log")).toBe(true);
    });

    it("only receives logs for subscribed project", async () => {
      const project1 = await seedProject(db, { ownerId: userId });
      const project2 = await seedProject(db, { ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${project1.id}/logs/stream`, {
        method: "POST",
      });

      const event = createRequestEvent(request, db, { id: project1.id }, true);

      const { POST } =
        await import("../../../../../../../src/routes/api/projects/[id]/logs/stream/+server");
      const response = await POST(event as never);

      const otherProjectLog = createMockLog(project2.id, { message: "Other project log" });
      logEventBus.emitLog(otherProjectLog);

      const subscribedLog = createMockLog(project1.id, { message: "Subscribed project log" });
      logEventBus.emitLog(subscribedLog);

      const events = await collectSSEEvents(response, 1, 3000);

      const logsEvent = events.find((e) => e.event === "logs");
      expect(logsEvent).toBeDefined();
      if (!logsEvent) throw new Error("Expected 'logs' event for the subscribed project");

      const logs = JSON.parse(logsEvent.data);
      expect(logs.every((l: Log) => l.projectId === project1.id)).toBe(true);
      expect(logs.some((l: Log) => l.message === "Subscribed project log")).toBe(true);
      expect(logs.some((l: Log) => l.message === "Other project log")).toBe(false);
    });
  });

  describe("Batching", () => {
    it("batches logs within 1.5s window", async () => {
      const project = await seedProject(db, { ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${project.id}/logs/stream`, {
        method: "POST",
      });

      const event = createRequestEvent(request, db, { id: project.id }, true);

      const { POST } =
        await import("../../../../../../../src/routes/api/projects/[id]/logs/stream/+server");
      const response = await POST(event as never);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const mockLogs = [
        createMockLog(project.id, { message: "Batch log 1" }),
        createMockLog(project.id, { message: "Batch log 2" }),
        createMockLog(project.id, { message: "Batch log 3" }),
      ];

      for (const log of mockLogs) {
        logEventBus.emitLog(log);
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const events = await collectSSEEvents(response, 1, 1000);

      const logsEvent = events.find((e) => e.event === "logs");
      expect(logsEvent).toBeDefined();
      if (!logsEvent) throw new Error("Expected logsEvent to be defined");

      const logs = JSON.parse(logsEvent.data);
      expect(logs.length).toBe(3);
      expect(logs.some((l: Log) => l.message === "Batch log 1")).toBe(true);
      expect(logs.some((l: Log) => l.message === "Batch log 2")).toBe(true);
      expect(logs.some((l: Log) => l.message === "Batch log 3")).toBe(true);
    });

    it("delivers all logs when a burst exceeds the batch size", async () => {
      const project = await seedProject(db, { ownerId: userId });
      const request = new Request(`http://localhost/api/projects/${project.id}/logs/stream`, {
        method: "POST",
      });
      const event = createRequestEvent(request, db, { id: project.id }, true);
      const { POST } =
        await import("../../../../../../../src/routes/api/projects/[id]/logs/stream/+server");
      const response = await POST(event as never);

      await new Promise((r) => setTimeout(r, 50)); // let subscription set up

      const TOTAL = 100;
      for (let i = 0; i < TOTAL; i++) {
        logEventBus.emitLog(createMockLog(project.id, { message: `burst ${i}` }));
      }

      const events = await collectSSEEvents(response, 5, 3000);
      const received = events
        .filter((e) => e.event === "logs")
        .flatMap((e) => JSON.parse(e.data) as Log[]);

      expect(received.length).toBe(TOTAL);
    });

    it("flushes immediately when batch reaches 50 logs", async () => {
      const project = await seedProject(db, { ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${project.id}/logs/stream`, {
        method: "POST",
      });

      const event = createRequestEvent(request, db, { id: project.id }, true);

      const { POST } =
        await import("../../../../../../../src/routes/api/projects/[id]/logs/stream/+server");
      const response = await POST(event as never);

      await new Promise((resolve) => setTimeout(resolve, 50));

      for (let i = 0; i < 50; i++) {
        logEventBus.emitLog(createMockLog(project.id, { message: `Rapid log ${i}` }));
      }

      const events = await collectSSEEvents(response, 1, 500);

      const logsEvent = events.find((e) => e.event === "logs");
      expect(logsEvent).toBeDefined();
      if (!logsEvent) throw new Error("Expected logsEvent to be defined");

      const logs = JSON.parse(logsEvent.data);
      expect(logs.length).toBe(50);
    });
  });

  describe("Backpressure", () => {
    it("closes the stream and unsubscribes a consumer that never reads", async () => {
      const project = await seedProject(db, { ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${project.id}/logs/stream`, {
        method: "POST",
      });

      const event = createRequestEvent(request, db, { id: project.id }, true);

      const { POST } =
        await import("../../../../../../../src/routes/api/projects/[id]/logs/stream/+server");
      const response = await POST(event as never);

      expect(logEventBus.getListenerCount(project.id)).toBe(1);

      // Nothing reads the body, so queued frames pile up until the byte budget is exceeded
      // and the stream gives up on the consumer instead of buffering it forever.
      let emitted = 0;
      while (logEventBus.getListenerCount(project.id) > 0 && emitted < 5000) {
        logEventBus.emitLog(createMockLog(project.id, { message: "x".repeat(1024) }));
        emitted += 1;
      }

      expect(logEventBus.getListenerCount(project.id)).toBe(0);

      // The stream ends so a stalled queue cannot pin it open; a stream that never
      // closes leaves this read pending and fails the test by timing out.
      const frames: Array<{ event: string; data: string }> = [];
      for await (const frame of parseSSEStream(response)) frames.push(frame);

      const delivered = frames
        .filter((frame) => frame.event === "logs")
        .flatMap((frame) => JSON.parse(frame.data) as Log[]);

      expect(delivered.length).toBeGreaterThan(0);
      // Rows past the budget were dropped, not buffered for the stalled consumer.
      expect(delivered.length).toBeLessThan(emitted);
    });
  });

  describe("Heartbeat", () => {
    it("emits a heartbeat frame on the configured interval", async () => {
      vi.useFakeTimers();
      try {
        const { createLogStreamResponse } =
          await import("../../../../../../../src/lib/server/live-stream");
        const response = createLogStreamResponse("heartbeat-project");

        expect(response.headers.get("Content-Type")).toBe("text/event-stream");
        const reader = response.body?.getReader();
        expect(reader).toBeDefined();

        const interval = SSE_CONFIG.HEARTBEAT_INTERVAL_MS;
        const read = reader!.read();
        await vi.advanceTimersByTimeAsync(interval + 1);
        const frame = new TextDecoder().decode((await read).value);

        expect(frame).toContain("event: heartbeat");

        await reader!.cancel();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("Cleanup", () => {
    it("removes listener from event bus on disconnect", async () => {
      const project = await seedProject(db, { ownerId: userId });

      const request = new Request(`http://localhost/api/projects/${project.id}/logs/stream`, {
        method: "POST",
      });

      const event = createRequestEvent(request, db, { id: project.id }, true);

      const { POST } =
        await import("../../../../../../../src/routes/api/projects/[id]/logs/stream/+server");

      const initialCount = logEventBus.getListenerCount(project.id);
      expect(initialCount).toBe(0);

      const response = await POST(event as never);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const connectedCount = logEventBus.getListenerCount(project.id);
      expect(connectedCount).toBe(1);

      const reader = response.body?.getReader();
      await reader?.cancel();

      await new Promise((resolve) => setTimeout(resolve, 100));

      const finalCount = logEventBus.getListenerCount(project.id);
      expect(finalCount).toBe(0);
    });
  });
});
