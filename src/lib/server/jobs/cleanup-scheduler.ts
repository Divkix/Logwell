import { Effect, Fiber, Schedule } from "effect";
import { RETENTION_CONFIG } from "#lib/server/config/performance.js";
import { cleanupOldLogs } from "./log-cleanup";

let scheduler: Fiber.Fiber<number> | null = null;

export function startCleanupScheduler(): boolean {
  if (scheduler) {
    return false;
  }

  // Runs now, then one full interval after each run ends, so runs never overlap. `spaced`, not
  // `fixed`: `fixed` fires immediately after a run that overruns a whole interval.
  scheduler = Effect.runFork(
    Effect.promise(runCleanup).pipe(
      Effect.repeat(Schedule.spaced(RETENTION_CONFIG.LOG_CLEANUP_INTERVAL_MS)),
    ),
  );

  console.log(
    `[cleanup-scheduler] Started with interval: ${RETENTION_CONFIG.LOG_CLEANUP_INTERVAL_MS}ms, retention: ${RETENTION_CONFIG.LOG_RETENTION_DAYS} days`,
  );

  return true;
}

export function stopCleanupScheduler(): void {
  if (!scheduler) return;

  // Abandons any in-flight run, which can't be cancelled; it finishes and logs on its own.
  Effect.runFork(Fiber.interrupt(scheduler));
  scheduler = null;
}

// Never rejects, so a failed run cannot end the repeat.
async function runCleanup(): Promise<void> {
  try {
    const result = await cleanupOldLogs();

    if (result.totalLogsDeleted > 0 || result.errors.length > 0) {
      console.log(
        `[cleanup-scheduler] Cleanup completed: ${result.totalLogsDeleted} logs deleted, ` +
          `${result.projectsProcessed} projects processed, ${result.projectsSkipped} skipped`,
      );
    }

    if (result.errors.length > 0) {
      console.error("[cleanup-scheduler] Errors during cleanup:", result.errors);
    }
  } catch (error) {
    console.error(
      "[cleanup-scheduler] Fatal error during cleanup:",
      error instanceof Error ? error.message : String(error),
    );
  }
}
