import { Deferred, Effect, Fiber, FiberHandle, Schedule } from "effect";
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
 * One SSE session: buffers items for BATCH_WINDOW_MS (flush early at MAX_BATCH_SIZE),
 * heartbeats every HEARTBEAT_INTERVAL_MS, drops batches while the consumer is over
 * MAX_BUFFERED_BYTES and ends once it never drains. The bus subscription, batch-window
 * timer and heartbeat all live in the session's Scope, so every exit (client cancel,
 * stall, defect) unsubscribes and stops them before the controller is closed once.
 *
 * Items are handled synchronously in the bus listener: a size flush and its backpressure
 * check must not wait for a scheduler tick, or a burst emitted in one tick would buffer
 * unbounded before the stall is noticed.
 */
function streamSession<T>(
  controller: ReadableStreamDefaultController<Uint8Array>,
  projectId: string,
  eventName: string,
  subscribe: Subscribe<T>,
): Effect.Effect<void> {
  const debugTag = `${eventName}/stream`;
  const encoder = new TextEncoder();

  return Effect.gen(function* () {
    // Completing it resumes the session synchronously: ended from the bus listener, the
    // scope unwinds (and the listener is removed) before that listener call returns.
    const ended = yield* Deferred.make<void>();
    const end = () => Deferred.doneUnsafe(ended, Effect.void);

    let consecutiveDrops = 0;

    const send = (name: string, data: string) => {
      const size = controller.desiredSize;

      if (size !== null && size < 0) {
        consecutiveDrops += 1;

        if (consecutiveDrops >= MAX_CONSECUTIVE_DROPS) {
          console.debug(`[${debugTag}] consumer stalled past buffer budget, closing stream`);
          end();
        } else {
          console.debug(`[${debugTag}] backpressure detected, dropping batch`);
        }

        return;
      }

      consecutiveDrops = 0;

      try {
        controller.enqueue(encoder.encode(formatSSEEvent(name, data)));
      } catch {
        end();
      }
    };

    let batch: T[] = [];

    const flush = () => {
      if (batch.length === 0) return;
      const data = JSON.stringify(batch);
      batch = [];
      send(eventName, data);
    };

    // At most one pending batch window, interrupted with the scope.
    const batchWindow = yield* FiberHandle.make();
    const startWindow = yield* FiberHandle.runtime(batchWindow)<never>();

    const flushAfterWindow = Effect.sync(flush).pipe(
      Effect.delay(BATCH_WINDOW_MS),
      Effect.tapDefect((defect) =>
        Effect.sync(() => console.error(`[${debugTag}] batch flush failed:`, defect)),
      ),
    );

    yield* Effect.acquireRelease(
      Effect.sync(() =>
        subscribe(projectId, (item) => {
          batch.push(item);

          if (batch.length >= MAX_BATCH_SIZE) {
            // Synchronous: the pending window fiber is asleep, so interrupting it completes now.
            Effect.runSync(FiberHandle.clear(batchWindow));
            flush();
          } else if (batch.length === 1) {
            startWindow(flushAfterWindow);
          }
        }),
      ),
      (unsubscribe) => Effect.sync(unsubscribe),
    );

    // Flush an immediate comment frame: without a first byte the client's fetch stays
    // pending (the UI keeps showing "Connecting...") until the first event or the heartbeat.
    controller.enqueue(encoder.encode(": connected\n\n"));

    yield* Effect.sync(() => send("heartbeat", JSON.stringify({ ts: Date.now() }))).pipe(
      Effect.schedule(Schedule.spaced(HEARTBEAT_INTERVAL_MS)),
      Effect.forkScoped,
    );

    yield* Deferred.await(ended);
  }).pipe(
    Effect.scoped,
    Effect.ensuring(
      Effect.sync(() => {
        try {
          controller.close();
        } catch {}
      }),
    ),
  );
}

function createProjectStreamResponse<T>(
  projectId: string,
  eventName: string,
  subscribe: Subscribe<T>,
): Response {
  // Assigned by `start`, which the ReadableStream constructor calls synchronously.
  let session!: Fiber.Fiber<void>;

  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        session = Effect.runFork(streamSession(controller, projectId, eventName, subscribe));
      },
      cancel: () => Effect.runPromise(Fiber.interrupt(session)),
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
