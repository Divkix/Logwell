import { RETENTION_CONFIG } from "$lib/server/config/performance";
import { cleanupOldLogs } from "./log-cleanup";

let cleanupStarted = false;
let cleanupIntervalId: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

export function startCleanupScheduler(): boolean {
  if (cleanupStarted) {
    return false;
  }

  cleanupStarted = true;

  void runCleanupWithGuard();

  cleanupIntervalId = setInterval(runCleanupWithGuard, RETENTION_CONFIG.LOG_CLEANUP_INTERVAL_MS);

  console.log(
    `[cleanup-scheduler] Started with interval: ${RETENTION_CONFIG.LOG_CLEANUP_INTERVAL_MS}ms, retention: ${RETENTION_CONFIG.LOG_RETENTION_DAYS} days`,
  );

  return true;
}

export function stopCleanupScheduler(): void {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
  }
  cleanupStarted = false;
  isRunning = false;
}

async function runCleanupWithGuard(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  try {
    await runCleanup();
  } finally {
    isRunning = false;
  }
}

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
