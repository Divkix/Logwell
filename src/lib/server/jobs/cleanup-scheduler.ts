import { RETENTION_CONFIG } from "$lib/server/config/performance";
import { cleanupOldLogs } from "./log-cleanup";

let cleanupStarted = false;
let cleanupIntervalId: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

/**
 * Starts the log cleanup scheduler.
 *
 * - Runs cleanup immediately on first call
 * - Schedules periodic cleanup at configured interval
 * - Handles errors gracefully (logs and continues)
 * - Only starts once (subsequent calls are no-ops)
 *
 * @returns true if scheduler was started, false if already running
 */
export function startCleanupScheduler(): boolean {
  if (cleanupStarted) {
    return false;
  }

  cleanupStarted = true;

  // Run immediately on startup
  void runCleanupWithGuard();

  // Schedule periodic runs
  cleanupIntervalId = setInterval(runCleanupWithGuard, RETENTION_CONFIG.LOG_CLEANUP_INTERVAL_MS);

  console.log(
    `[cleanup-scheduler] Started with interval: ${RETENTION_CONFIG.LOG_CLEANUP_INTERVAL_MS}ms, retention: ${RETENTION_CONFIG.LOG_RETENTION_DAYS} days`,
  );

  return true;
}

/**
 * Stops the cleanup scheduler.
 * Primarily useful for testing.
 */
export function stopCleanupScheduler(): void {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
  }
  cleanupStarted = false;
}

/**
 * Overlap guard: skips the cycle if a previous one is still running.
 */
async function runCleanupWithGuard(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  try {
    await runCleanup();
  } finally {
    isRunning = false;
  }
}

/**
 * Runs a single cleanup cycle.
 * Handles errors gracefully to prevent scheduler crash.
 */
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
