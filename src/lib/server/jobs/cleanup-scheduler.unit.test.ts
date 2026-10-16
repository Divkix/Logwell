import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vite-plus/test";
import { startCleanupScheduler, stopCleanupScheduler } from "./cleanup-scheduler";
import type { CleanupResult } from "./log-cleanup";
import type { PurgeResult } from "./project-purge";

const mocks = vi.hoisted(() => ({
  intervalMs: 60_000,
  cleanupOldLogs: vi.fn<() => Promise<CleanupResult>>(),
  purgeDeletedProjects: vi.fn<() => Promise<PurgeResult>>(),
}));

const INTERVAL_MS = mocks.intervalMs;

// The unit project resolves no `$lib` runtime specifiers, and the real cleanup needs a database.
vi.mock("#lib/server/config/performance.js", () => ({
  RETENTION_CONFIG: { LOG_CLEANUP_INTERVAL_MS: mocks.intervalMs, LOG_RETENTION_DAYS: 30 },
}));

vi.mock("./log-cleanup", () => ({ cleanupOldLogs: mocks.cleanupOldLogs }));

vi.mock("./project-purge", () => ({ purgeDeletedProjects: mocks.purgeDeletedProjects }));

function purgeResult(overrides: Partial<PurgeResult> = {}): PurgeResult {
  return { projectsPurged: 0, logsDeleted: 0, incidentsDeleted: 0, errors: [], ...overrides };
}

function result(
  totalLogsDeleted = 0,
  errors: string[] = [],
  totalIncidentsDeleted = 0,
): CleanupResult {
  return {
    projectsProcessed: 1,
    projectsSkipped: 0,
    totalLogsDeleted,
    totalIncidentsDeleted,
    errors,
  };
}

function deferred() {
  let resolve!: (value: CleanupResult) => void;

  const promise = new Promise<CleanupResult>((r) => {
    resolve = r;
  });

  return { promise, resolve };
}

const calls = () => mocks.cleanupOldLogs.mock.calls.length;

describe("cleanup scheduler", () => {
  let log: MockInstance<typeof console.log>;
  let logError: MockInstance<typeof console.error>;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.cleanupOldLogs.mockReset();
    mocks.cleanupOldLogs.mockResolvedValue(result());
    mocks.purgeDeletedProjects.mockReset();
    mocks.purgeDeletedProjects.mockResolvedValue(purgeResult());
    log = vi.spyOn(console, "log").mockImplementation(() => {});
    logError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    stopCleanupScheduler();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("runs immediately, then once per interval", async () => {
    expect(startCleanupScheduler()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls()).toBe(1);
    expect(log).toHaveBeenCalledWith(
      `[cleanup-scheduler] Started with interval: ${INTERVAL_MS}ms, retention: 30 days`,
    );

    await vi.advanceTimersByTimeAsync(INTERVAL_MS - 1);
    expect(calls()).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(calls()).toBe(2);

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(calls()).toBe(3);
  });

  it("refuses to start twice", async () => {
    expect(startCleanupScheduler()).toBe(true);
    expect(startCleanupScheduler()).toBe(false);

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(calls()).toBe(2);
  });

  it("never overlaps a slow run", async () => {
    const slow = deferred();
    mocks.cleanupOldLogs.mockReturnValueOnce(slow.promise);

    startCleanupScheduler();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2.5);
    expect(calls()).toBe(1);

    slow.resolve(result());
    await vi.advanceTimersByTimeAsync(0);
    expect(calls()).toBe(1);

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(calls()).toBe(2);
  });

  it("keeps running after a run throws", async () => {
    mocks.cleanupOldLogs.mockRejectedValueOnce(new Error("db down"));

    startCleanupScheduler();
    await vi.advanceTimersByTimeAsync(0);
    expect(logError).toHaveBeenCalledWith(
      "[cleanup-scheduler] Fatal error during cleanup:",
      "db down",
    );

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(calls()).toBe(2);
  });

  it("logs a summary only when rows were deleted or errors occurred", async () => {
    mocks.cleanupOldLogs
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result(5))
      .mockResolvedValueOnce(result(0, ["project p1: boom"]))
      .mockResolvedValueOnce(result(0, [], 3));

    const summaries = () =>
      log.mock.calls.filter(([line]) => String(line).includes("Cleanup completed")).length;

    startCleanupScheduler();
    await vi.advanceTimersByTimeAsync(0);
    expect(summaries()).toBe(0);

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(summaries()).toBe(1);
    expect(log).toHaveBeenLastCalledWith(
      "[cleanup-scheduler] Cleanup completed: 5 logs deleted, 0 incidents deleted, 1 projects processed, 0 skipped",
    );
    expect(logError).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(summaries()).toBe(2);
    expect(logError).toHaveBeenCalledWith("[cleanup-scheduler] Errors during cleanup:", [
      "project p1: boom",
    ]);

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(summaries()).toBe(3);
    expect(log).toHaveBeenLastCalledWith(
      "[cleanup-scheduler] Cleanup completed: 0 logs deleted, 3 incidents deleted, 1 projects processed, 0 skipped",
    );
  });

  it("purges deleted projects before each retention pass", async () => {
    const order: string[] = [];
    mocks.purgeDeletedProjects.mockImplementation(async () => {
      order.push("purge");

      return purgeResult({ projectsPurged: 1, logsDeleted: 7, incidentsDeleted: 2 });
    });
    mocks.cleanupOldLogs.mockImplementation(async () => {
      order.push("retention");

      return result();
    });

    startCleanupScheduler();
    await vi.advanceTimersByTimeAsync(0);

    expect(order).toEqual(["purge", "retention"]);
    expect(log).toHaveBeenCalledWith(
      "[cleanup-scheduler] Purge completed: 1 deleted projects removed, 7 logs and 2 incidents deleted",
    );
  });

  it("still runs retention when the purge throws", async () => {
    mocks.purgeDeletedProjects.mockRejectedValueOnce(new Error("db down"));

    startCleanupScheduler();
    await vi.advanceTimersByTimeAsync(0);

    expect(logError).toHaveBeenCalledWith(
      "[cleanup-scheduler] Fatal error during purge:",
      "db down",
    );
    expect(calls()).toBe(1);
  });

  it("stops future runs and can start again", async () => {
    startCleanupScheduler();
    await vi.advanceTimersByTimeAsync(0);
    stopCleanupScheduler();

    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
    expect(calls()).toBe(1);

    expect(startCleanupScheduler()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls()).toBe(2);
  });

  it("stops quietly while a run is in flight", async () => {
    const slow = deferred();
    mocks.cleanupOldLogs.mockReturnValueOnce(slow.promise);

    startCleanupScheduler();
    await vi.advanceTimersByTimeAsync(0);
    stopCleanupScheduler();

    slow.resolve(result());
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
    expect(calls()).toBe(1);
    expect(logError).not.toHaveBeenCalled();
  });
});
