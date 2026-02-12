import { SSE_CONFIG } from '$lib/server/config/performance';
import type { Incident } from '$lib/server/db/schema';
import { logEventBus } from '$lib/server/events';
import { isErrorResponse, requireProjectOwnership } from '$lib/server/utils/project-guard';
import type { RequestEvent } from './$types';

const { BATCH_WINDOW_MS, MAX_BATCH_SIZE, HEARTBEAT_INTERVAL_MS } = SSE_CONFIG;

function formatSSEEvent(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`;
}

/**
 * POST /api/projects/[id]/incidents/stream
 *
 * Server-Sent Events endpoint for real-time incident streaming.
 * Requires session authentication and project ownership.
 */
export async function POST(event: RequestEvent): Promise<Response> {
  const authResult = await requireProjectOwnership(event, event.params.id);
  if (isErrorResponse(authResult)) return authResult;

  const projectId = event.params.id;
  let cleanupFn: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let batch: Incident[] = [];
      let flushTimeout: ReturnType<typeof setTimeout> | null = null;
      let isClosed = false;

      const sendEvent = (eventName: string, data: string): boolean => {
        if (isClosed) return false;
        try {
          controller.enqueue(encoder.encode(formatSSEEvent(eventName, data)));
          return true;
        } catch {
          return false;
        }
      };

      const flushBatch = () => {
        if (batch.length > 0) {
          const success = sendEvent('incidents', JSON.stringify(batch));
          if (!success) cleanup();
          batch = [];
        }
        flushTimeout = null;
      };

      const handleIncident = (incident: Incident) => {
        if (isClosed) return;
        batch.push(incident);

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

      const unsubscribe = logEventBus.onIncident(projectId, handleIncident);
      const heartbeatInterval = setInterval(() => {
        const success = sendEvent('heartbeat', JSON.stringify({ ts: Date.now() }));
        if (!success) cleanup();
      }, HEARTBEAT_INTERVAL_MS);

      const cleanup = () => {
        if (isClosed) return;
        isClosed = true;
        unsubscribe();
        clearInterval(heartbeatInterval);
        if (flushTimeout) clearTimeout(flushTimeout);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      cleanupFn = cleanup;
    },
    cancel() {
      if (cleanupFn) cleanupFn();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
