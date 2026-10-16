import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { SSE_CONFIG } from "#lib/server/config/performance.js";
import type { Incident } from "#lib/server/db/schema.js";
import { logEventBus, type StreamLog } from "#lib/server/events.js";
import { createIncidentStreamResponse, createLogStreamResponse } from "#lib/server/live-stream.js";

const { BATCH_WINDOW_MS, MAX_BATCH_SIZE, HEARTBEAT_INTERVAL_MS } = SSE_CONFIG;

function mockLog(projectId: string, message: string): StreamLog {
  // SAFETY: the stream routes on projectId and serializes the row as-is; the assertions
  // below read only message, so the remaining Log fields are never touched.
  return { projectId, message } as StreamLog;
}

// Reads the body continuously (a consumer that always drains) and keeps each SSE frame.
function readFrames(response: Response) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const frames: string[] = [];

  void (async () => {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) return;
      frames.push(decoder.decode(value));
    }
  })();

  const batches = (event: string) =>
    frames.flatMap((frame) =>
      frame.startsWith(`event: ${event}\n`)
        ? // SAFETY: the stream writes every batch frame's data line as JSON.stringify of an array.
          [JSON.parse(frame.slice(frame.indexOf("data: ") + 6)) as unknown[]]
        : [],
    );

  return { frames, batches, cancel: () => reader.cancel() };
}

describe("live stream session", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    logEventBus.clear();
  });

  afterEach(() => {
    logEventBus.clear();
    vi.useRealTimers();
  });

  it("flushes a partial batch once the batch window elapses", async () => {
    const stream = readFrames(createLogStreamResponse("p1"));

    for (const message of ["a", "b", "c"]) logEventBus.emitLog(mockLog("p1", message));

    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS - 1);
    expect(stream.batches("logs")).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(stream.batches("logs")).toHaveLength(1);
    expect(stream.batches("logs")[0]).toHaveLength(3);

    await stream.cancel();
  });

  it("opens a fresh window for items that follow a size flush", async () => {
    const stream = readFrames(createLogStreamResponse("p1"));

    for (let i = 0; i < MAX_BATCH_SIZE; i++) logEventBus.emitLog(mockLog("p1", `burst ${i}`));

    await vi.advanceTimersByTimeAsync(0);
    expect(stream.batches("logs")).toHaveLength(1);

    const half = Math.floor(BATCH_WINDOW_MS / 2);
    await vi.advanceTimersByTimeAsync(half);
    logEventBus.emitLog(mockLog("p1", "late"));

    // Past the first item's window: a window left over from the size-flushed batch must
    // not cut the new batch short.
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS - half);
    expect(stream.batches("logs")).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(half);
    expect(stream.batches("logs")).toHaveLength(2);
    expect(stream.batches("logs")[1]).toEqual([{ projectId: "p1", message: "late" }]);

    await stream.cancel();
  });

  it("unsubscribes and stops every timer when the client cancels", async () => {
    const stream = readFrames(createLogStreamResponse("p1"));

    logEventBus.emitLog(mockLog("p1", "pending"));
    await vi.advanceTimersByTimeAsync(0);
    expect(logEventBus.getListenerCount("p1")).toBe(1);

    await stream.cancel();

    expect(logEventBus.getListenerCount("p1")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    const framesAtCancel = stream.frames.length;
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + BATCH_WINDOW_MS);
    expect(stream.frames).toHaveLength(framesAtCancel);
  });

  it("streams incidents as `incidents` events on the incident channel", async () => {
    const stream = readFrames(createIncidentStreamResponse("p1"));

    // SAFETY: the stream routes on projectId and serializes the row as-is; the assertions
    // below read only fingerprint, so the remaining Incident fields are never touched.
    logEventBus.emitIncident({ projectId: "p1", fingerprint: "f1" } as Incident);
    logEventBus.emitLog(mockLog("p1", "not an incident"));

    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS);
    expect(stream.batches("incidents")).toEqual([[{ projectId: "p1", fingerprint: "f1" }]]);
    expect(stream.batches("logs")).toEqual([]);

    await stream.cancel();
    expect(logEventBus.getIncidentListenerCount("p1")).toBe(0);
  });
});
