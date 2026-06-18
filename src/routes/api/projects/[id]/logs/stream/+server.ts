import { SSE_CONFIG } from "$lib/server/config/performance";
import type { Log } from "$lib/server/db/schema";
import { logEventBus } from "$lib/server/events";
import { checkCsrfOrigin } from "$lib/server/utils/csrf";
import { isErrorResponse, requireProjectOwnership } from "$lib/server/utils/project-guard";
import type { RequestEvent } from "./$types";

// Destructure SSE configuration for cleaner access
const { BATCH_WINDOW_MS, MAX_BATCH_SIZE, HEARTBEAT_INTERVAL_MS } = SSE_CONFIG;

/**
 * Format an SSE event
 */
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
  // CSRF check
  const csrfError = checkCsrfOrigin(event);
  if (csrfError) return csrfError;

  // Require authentication and project ownership
  const authResult = await requireProjectOwnership(event, event.params.id);
  if (isErrorResponse(authResult)) return authResult;

  const projectId = event.params.id;

  // Store cleanup function outside the stream for cancel handler access
  let cleanupFn: (() => void) | null = null;

  // Create a readable stream for SSE.
  // Use a CountQueuingStrategy with a generous highWaterMark so a 100-log
  // burst (BATCH_INSERT_LIMIT) plus heartbeats never drive desiredSize to 0
  // under normal operation, and genuine backpressure only triggers when the
  // queue actually exceeds the mark (desiredSize < 0).
  const stream = new ReadableStream(
    {
      start(controller) {
        const encoder = new TextEncoder();

        // Buffer for batching logs
        let batch: Log[] = [];
        let flushTimeout: ReturnType<typeof setTimeout> | null = null;
        let isClosed = false;

        /**
         * Send an SSE event to the client.
         * Returns 'sent' | 'backpressure' | 'closed'.
         * Backpressure (slow consumer) drops the event but keeps the stream open.
         * 'closed' means the controller has errored and the stream should be torn down.
         */
        const sendEvent = (eventName: string, data: string): "sent" | "backpressure" | "closed" => {
          if (isClosed) return "closed";
          try {
            const size = (controller as ReadableStreamDefaultController).desiredSize;
            if (size !== null && size < 0) {
              // Stream backpressure: slow consumer, drop the event but keep the stream alive
              console.debug("[logs/stream] backpressure detected, dropping batch");
              return "backpressure";
            }
            controller.enqueue(encoder.encode(formatSSEEvent(eventName, data)));
            return "sent";
          } catch {
            // Controller closed or errored
            return "closed";
          }
        };

        /**
         * Flush the current batch to the client
         */
        const flushBatch = () => {
          if (batch.length > 0) {
            const result = sendEvent("logs", JSON.stringify(batch));
            if (result === "closed") {
              cleanup();
            }
            // On 'backpressure', drop the batch but don't close the stream
            batch = [];
          }
          flushTimeout = null;
        };

        /**
         * Handler for incoming logs from event bus
         */
        const handleLog = (log: Log) => {
          if (isClosed) return;
          batch.push(log);

          // Start batch timer if not already running
          if (!flushTimeout) {
            flushTimeout = setTimeout(flushBatch, BATCH_WINDOW_MS);
          }

          // Flush immediately if batch is full
          if (batch.length >= MAX_BATCH_SIZE) {
            if (flushTimeout) {
              clearTimeout(flushTimeout);
              flushTimeout = null;
            }
            flushBatch();
          }
        };

        // Subscribe to log events for this project
        const unsubscribe = logEventBus.onLog(projectId, handleLog);

        // Set up heartbeat to keep connection alive
        const heartbeatInterval = setInterval(() => {
          const result = sendEvent("heartbeat", JSON.stringify({ ts: Date.now() }));
          if (result === "closed") {
            cleanup();
          }
        }, HEARTBEAT_INTERVAL_MS);

        /**
         * Cleanup function to unsubscribe and clear timers
         */
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
          } catch {
            // Already closed
          }
        };

        // Store cleanup for cancel handler
        cleanupFn = cleanup;
      },
      cancel() {
        // Called when client disconnects
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
    },
  });
}
