import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '$lib/server/db/schema';
import { type Log, project } from '$lib/server/db/schema';
import { logEventBus } from '$lib/server/events';
import { requireAuth } from '$lib/server/utils/auth-guard';
import type { RequestEvent } from './$types';

type DatabaseClient = PostgresJsDatabase<typeof schema> | PgliteDatabase<typeof schema>;

// Configuration
const BATCH_WINDOW_MS = 1500; // 1.5 second batch window
const MAX_BATCH_SIZE = 50; // Flush immediately at this size
const HEARTBEAT_INTERVAL_MS = 30000; // 30 seconds

/**
 * Helper to get database client from locals or production db
 * Supports test injection via locals.db
 */
async function getDbClient(locals: App.Locals): Promise<DatabaseClient> {
  if (locals.db) {
    return locals.db as DatabaseClient;
  }
  const { db } = await import('$lib/server/db');
  return db;
}

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
 * Requires session authentication.
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
  // Require session authentication first
  await requireAuth(event);

  const db = await getDbClient(event.locals);
  const projectId = event.params.id;

  // Verify project exists before starting stream
  const [projectData] = await db
    .select({ id: project.id })
    .from(project)
    .where(eq(project.id, projectId));

  if (!projectData) {
    return json({ error: 'not_found', message: 'Project not found' }, { status: 404 });
  }

  // Store cleanup function outside the stream for cancel handler access
  let cleanupFn: (() => void) | null = null;

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Buffer for batching logs
      let batch: Log[] = [];
      let flushTimeout: ReturnType<typeof setTimeout> | null = null;
      let isClosed = false;

      /**
       * Send an SSE event to the client
       */
      const sendEvent = (eventName: string, data: string): boolean => {
        if (isClosed) return false;
        try {
          controller.enqueue(encoder.encode(formatSSEEvent(eventName, data)));
          return true;
        } catch {
          // Controller closed
          return false;
        }
      };

      /**
       * Flush the current batch to the client
       */
      const flushBatch = () => {
        if (batch.length > 0) {
          const success = sendEvent('logs', JSON.stringify(batch));
          if (!success) {
            cleanup();
          }
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
        const success = sendEvent('heartbeat', JSON.stringify({ ts: Date.now() }));
        if (!success) {
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
