import { SSE_CONFIG } from "$lib/server/config/performance";
import type { Incident } from "$lib/server/db/schema";
import { type Listener, logEventBus, type StreamLog } from "$lib/server/events";

const { BATCH_WINDOW_MS, MAX_BATCH_SIZE, HEARTBEAT_INTERVAL_MS } = SSE_CONFIG;

// Bytes of undelivered SSE frames a slow consumer may accumulate before batches are dropped.
const MAX_BUFFERED_BYTES = 256 * 1024;

// Consecutive dropped sends after which a permanently stalled consumer is disconnected
// (it reconnects on its own); dropping alone would keep its listener and buffer forever.
const MAX_CONSECUTIVE_DROPS = 10;

function formatSSEEvent(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`;
}

export type Subscribe<T> = (projectId: string, listener: Listener<T>) => () => void;

/**
 * One SSE stream: buffers items for BATCH_WINDOW_MS (flush early at MAX_BATCH_SIZE),
 * heartbeats every HEARTBEAT_INTERVAL_MS, drops batches while a consumer is over
 * MAX_BUFFERED_BYTES, disconnects a consumer that never drains, unsubscribes +
 * clears timers on disconnect.
 */
function createProjectStreamResponse<T>(
  projectId: string,
  eventName: string,
  subscribe: Subscribe<T>,
): Response {
  const debugTag = `${eventName}/stream`;
  let cleanupFn: (() => void) | null = null;

  const stream = new ReadableStream(
    {
      start(controller) {
        const encoder = new TextEncoder();

        let batch: T[] = [];
        let flushTimeout: ReturnType<typeof setTimeout> | null = null;
        let isClosed = false;
        let consecutiveDrops = 0;

        const sendEvent = (name: string, data: string): "sent" | "backpressure" | "closed" => {
          if (isClosed) return "closed";
          try {
            const size = (controller as ReadableStreamDefaultController).desiredSize;
            if (size !== null && size < 0) {
              consecutiveDrops += 1;
              if (consecutiveDrops >= MAX_CONSECUTIVE_DROPS) {
                console.debug(`[${debugTag}] consumer stalled past buffer budget, closing stream`);
                cleanup();
                return "closed";
              }
              console.debug(`[${debugTag}] backpressure detected, dropping batch`);
              return "backpressure";
            }
            consecutiveDrops = 0;
            controller.enqueue(encoder.encode(formatSSEEvent(name, data)));
            return "sent";
          } catch {
            return "closed";
          }
        };

        const flushBatch = () => {
          if (batch.length > 0) {
            if (sendEvent(eventName, JSON.stringify(batch)) === "closed") cleanup();
            batch = [];
          }
          flushTimeout = null;
        };

        const handleItem = (item: T) => {
          if (isClosed) return;
          batch.push(item);

          if (!flushTimeout) {
            flushTimeout = setTimeout(flushBatch, BATCH_WINDOW_MS);
          }

          if (batch.length >= MAX_BATCH_SIZE) {
            if (flushTimeout) {
              clearTimeout(flushTimeout);
              flushTimeout = null;
            }
            flushBatch();
          }
        };

        const unsubscribe = subscribe(projectId, handleItem);

        const heartbeatInterval = setInterval(() => {
          if (sendEvent("heartbeat", JSON.stringify({ ts: Date.now() })) === "closed") cleanup();
        }, HEARTBEAT_INTERVAL_MS);

        const cleanup = () => {
          if (isClosed) return;
          isClosed = true;
          unsubscribe();
          clearInterval(heartbeatInterval);
          if (flushTimeout) clearTimeout(flushTimeout);
          try {
            controller.close();
          } catch {}
        };

        cleanupFn = cleanup;
      },
      cancel() {
        if (cleanupFn) cleanupFn();
      },
    },
    // Byte-length strategy: `desiredSize` below 0 means the queued frames exceed
    // MAX_BUFFERED_BYTES, so a stall is measured in memory rather than chunk count.
    new ByteLengthQueuingStrategy({ highWaterMark: MAX_BUFFERED_BYTES }),
  );

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export function createLogStreamResponse(projectId: string): Response {
  return createProjectStreamResponse<StreamLog>(
    projectId,
    "logs",
    logEventBus.onLog.bind(logEventBus),
  );
}

export function createIncidentStreamResponse(projectId: string): Response {
  return createProjectStreamResponse<Incident>(
    projectId,
    "incidents",
    logEventBus.onIncident.bind(logEventBus),
  );
}
