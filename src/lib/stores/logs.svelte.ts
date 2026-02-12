import type { LogLevel } from '$lib/shared/types';

/**
 * Client-side log representation for UI rendering
 * Matches the server-side Log type but with ISO string timestamp
 */
export interface ClientLog {
  id: string;
  projectId: string;
  level: LogLevel;
  message: string;
  metadata: unknown;
  incidentId: string | null;
  fingerprint: string | null;
  serviceName: string | null;
  sourceFile: string | null;
  lineNumber: number | null;
  requestId: string | null;
  userId: string | null;
  ipAddress: string | null;
  timestamp: string;
}

/**
 * Configuration options for the log stream store
 */
export interface LogStreamStoreOptions {
  maxLogs?: number;
}

/**
 * Default maximum number of logs to keep in memory
 */
const DEFAULT_MAX_LOGS = 1000;

/**
 * Creates a reactive log stream store for managing real-time logs
 *
 * Features:
 * - Prepends new logs to maintain newest-first order
 * - Enforces maxLogs limit to prevent memory issues
 * - Clears logs when project changes
 *
 * @param options - Store configuration options
 * @returns Log stream store instance
 */
export function createLogStreamStore(options: LogStreamStoreOptions = {}) {
  const maxLogs = options.maxLogs ?? DEFAULT_MAX_LOGS;

  // Internal state
  let _logs: ClientLog[] = [];
  let _projectId: string | null = null;

  return {
    /**
     * Maximum number of logs to keep in memory
     */
    get maxLogs(): number {
      return maxLogs;
    },

    /**
     * Current logs array (newest first)
     */
    get logs(): ClientLog[] {
      return _logs;
    },

    /**
     * Current project ID
     */
    get projectId(): string | null {
      return _projectId;
    },

    /**
     * Number of logs currently in the store
     */
    get logCount(): number {
      return _logs.length;
    },

    /**
     * Adds new logs to the store (prepends to maintain newest-first order)
     * Trims oldest logs if exceeding maxLogs limit
     *
     * Optimized to avoid creating intermediate arrays larger than maxLogs.
     *
     * @param newLogs - Array of logs to add
     */
    addLogs(newLogs: ClientLog[]): void {
      if (newLogs.length === 0) return;

      const newCount = newLogs.length;

      // If new logs alone fill or exceed maxLogs, just use them (trimmed)
      if (newCount >= maxLogs) {
        _logs = newLogs.slice(0, maxLogs);
        return;
      }

      // Calculate how many existing logs we can keep
      const keepFromExisting = Math.min(_logs.length, maxLogs - newCount);

      if (keepFromExisting === 0) {
        // No existing logs or none to keep
        _logs = newLogs;
      } else if (keepFromExisting === _logs.length) {
        // Can keep all existing logs - just prepend
        _logs = [...newLogs, ..._logs];
      } else {
        // Need to trim existing logs - slice before spreading to avoid large intermediate array
        _logs = [...newLogs, ..._logs.slice(0, keepFromExisting)];
      }
    },

    /**
     * Clears all logs from the store
     */
    clearLogs(): void {
      _logs = [];
    },

    /**
     * Sets the current project ID
     * Clears logs if project changes (to a different non-null value or to null)
     *
     * @param projectId - New project ID or null
     */
    setProjectId(projectId: string | null): void {
      // Only clear logs if the project actually changes
      if (_projectId !== projectId) {
        _logs = [];
        _projectId = projectId;
      }
    },
  };
}
