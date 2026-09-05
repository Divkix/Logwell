import { SSE_CONFIG } from "$lib/server/config/performance";
import { logEventBus, type StreamLog } from "$lib/server/events";
import { checkCsrfOrigin } from "$lib/server/utils/csrf";
import { isErrorResponse, requireProjectOwnership } from "$lib/server/utils/project-guard";
import type { RequestEvent } from "./$types";

const { BATCH_WINDOW_MS, MAX_BATCH_SIZE, HEARTBEAT_INTERVAL_MS } = SSE_CONFIG;

function formatSSEEvent(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`;
}

/**
 * POST /api/projects/[id]/logs/stream
 *
 * Server-Sent Events endpoint for real-time log streaming.
 * Requires session authentication and project ownership.
 *
 * SSE Events:
 * - `logs`: Batched array of Log objects
 * - `heartbeat`: Keep-alive ping with timestamp
 *
 * Batching behavior:
 * - Logs are buffered for 1.5 seconds before emitting
 * - If batch reaches 50 logs, flush immediately
 * - Only logs for the subscribed project are emitted
 */
export async function POST(event: RequestEvent): Promise<Response> {
  const csrfError = checkCsrfOrigin(event);
  if (csrfError) return csrfError;

  const authResult = await requireProjectOwnership(event, event.params.id);
  if (isErrorResponse(authResult)) return authResult;

  const projectId = event.params.id;

  let cleanupFn: (() => void) | null = null;

  const stream = new ReadableStream(
    {
      start(controller) {
        const encoder = new TextEncoder();

        let batch: StreamLog[] = [];
        let flushTimeout: ReturnType<typeof setTimeout> | null = null;
        let isClosed = false;

        const sendEvent = (eventName: string, data: string): "sent" | "backpressure" | "closed" => {
          if (isClosed) return "closed";
          try {
            const size = (controller as ReadableStreamDefaultController).desiredSize;
            if (size !== null && size < 0) {
              console.debug("[logs/stream] backpressure detected, dropping batch");
              return "backpressure";
            }
            controller.enqueue(encoder.encode(formatSSEEvent(eventName, data)));
            return "sent";
          } catch {
            return "closed";
          }
        };

        const flushBatch = () => {
          if (batch.length > 0) {
            const result = sendEvent("logs", JSON.stringify(batch));
            if (result === "closed") {
              cleanup();
            }
            batch = [];
          }
          flushTimeout = null;
        };

        const handleLog = (log: StreamLog) => {
          if (isClosed) return;
          batch.push(log);

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

        const unsubscribe = logEventBus.onLog(projectId, handleLog);

        const heartbeatInterval = setInterval(() => {
          const result = sendEvent("heartbeat", JSON.stringify({ ts: Date.now() }));
          if (result === "closed") {
            cleanup();
          }
        }, HEARTBEAT_INTERVAL_MS);

        const cleanup = () => {
          if (isClosed) return;
          isClosed = true;
          unsubscribe();
          clearInterval(heartbeatInterval);
          if (flushTimeout) {
            clearTimeout(flushTimeout);
          }
          try {
            controller.close();
          } catch {}
        };

        cleanupFn = cleanup;
      },
      cancel() {
        if (cleanupFn) {
          cleanupFn();
        }
      },
    },
    new CountQueuingStrategy({ highWaterMark: 256 }),
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
