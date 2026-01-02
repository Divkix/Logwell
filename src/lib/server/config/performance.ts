/**
 * Performance configuration module for sv-logger.
 *
 * This module centralizes all performance-related configuration parameters,
 * making them configurable via environment variables while providing
 * sensible defaults and validation.
 *
 * Configuration can be overridden via environment variables:
 * - SSE_BATCH_WINDOW_MS: Time window for batching SSE events (default: 1500ms)
 * - SSE_MAX_BATCH_SIZE: Maximum logs per batch before flush (default: 50)
 * - SSE_HEARTBEAT_INTERVAL_MS: Heartbeat interval (default: 30000ms)
 * - LOG_STREAM_MAX_LOGS: Maximum logs in memory per client (default: 1000)
 */

/**
 * Safely parses an environment variable as a number.
 * Returns defaultValue if the env var is not set or not a valid number.
 */
function parseEnvInt(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined || value === '') {
    return defaultValue;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Clamps a value between min and max bounds.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// SSE Configuration defaults and bounds
const SSE_DEFAULTS = {
  BATCH_WINDOW_MS: 1500,
  MAX_BATCH_SIZE: 50,
  HEARTBEAT_INTERVAL_MS: 30000,
} as const;

const SSE_BOUNDS = {
  BATCH_WINDOW_MS: { min: 100, max: 10000 },
  MAX_BATCH_SIZE: { min: 1, max: 500 },
  HEARTBEAT_INTERVAL_MS: { min: 5000, max: 300000 },
} as const;

/**
 * SSE (Server-Sent Events) streaming configuration.
 *
 * - BATCH_WINDOW_MS: Time window to batch logs before sending (reduces network overhead)
 * - MAX_BATCH_SIZE: Maximum logs per batch (flush immediately when reached)
 * - HEARTBEAT_INTERVAL_MS: Keep-alive ping interval (prevents connection timeout)
 */
export const SSE_CONFIG = {
  BATCH_WINDOW_MS: clamp(
    parseEnvInt('SSE_BATCH_WINDOW_MS', SSE_DEFAULTS.BATCH_WINDOW_MS),
    SSE_BOUNDS.BATCH_WINDOW_MS.min,
    SSE_BOUNDS.BATCH_WINDOW_MS.max,
  ),
  MAX_BATCH_SIZE: clamp(
    parseEnvInt('SSE_MAX_BATCH_SIZE', SSE_DEFAULTS.MAX_BATCH_SIZE),
    SSE_BOUNDS.MAX_BATCH_SIZE.min,
    SSE_BOUNDS.MAX_BATCH_SIZE.max,
  ),
  HEARTBEAT_INTERVAL_MS: clamp(
    parseEnvInt('SSE_HEARTBEAT_INTERVAL_MS', SSE_DEFAULTS.HEARTBEAT_INTERVAL_MS),
    SSE_BOUNDS.HEARTBEAT_INTERVAL_MS.min,
    SSE_BOUNDS.HEARTBEAT_INTERVAL_MS.max,
  ),
} as const;

// Log Stream Configuration
const LOG_STREAM_DEFAULTS = {
  DEFAULT_MAX_LOGS: 1000,
  MAX_LOGS_UPPER_LIMIT: 10000,
} as const;

/**
 * Log stream store configuration.
 *
 * - DEFAULT_MAX_LOGS: Default maximum logs to keep in memory per client
 * - MAX_LOGS_UPPER_LIMIT: Hard upper limit (prevents excessive memory usage)
 */
export const LOG_STREAM_CONFIG = {
  MAX_LOGS_UPPER_LIMIT: LOG_STREAM_DEFAULTS.MAX_LOGS_UPPER_LIMIT,
  DEFAULT_MAX_LOGS: clamp(
    parseEnvInt('LOG_STREAM_MAX_LOGS', LOG_STREAM_DEFAULTS.DEFAULT_MAX_LOGS),
    1,
    LOG_STREAM_DEFAULTS.MAX_LOGS_UPPER_LIMIT,
  ),
} as const;

/**
 * API configuration for rate limiting and pagination.
 *
 * - BATCH_INSERT_LIMIT: Maximum logs per batch insert API call
 * - DEFAULT_PAGE_SIZE: Default page size for log queries
 * - MAX_PAGE_SIZE: Maximum allowed page size
 */
export const API_CONFIG = {
  BATCH_INSERT_LIMIT: 100,
  DEFAULT_PAGE_SIZE: 100,
  MAX_PAGE_SIZE: 500,
} as const;

/**
 * Export configuration for log export operations.
 *
 * - MAX_LOGS: Maximum number of logs that can be exported in a single request
 */
export const EXPORT_CONFIG = {
  MAX_LOGS: 10000,
} as const;

/**
 * Type for SSE configuration object.
 */
export type SSEConfigType = {
  BATCH_WINDOW_MS: number;
  MAX_BATCH_SIZE: number;
  HEARTBEAT_INTERVAL_MS: number;
};

/**
 * Validates SSE configuration values.
 * Returns true if all values are within acceptable bounds.
 */
export function validateSSEConfig(config: SSEConfigType): boolean {
  if (config.BATCH_WINDOW_MS < SSE_BOUNDS.BATCH_WINDOW_MS.min) return false;
  if (config.MAX_BATCH_SIZE < SSE_BOUNDS.MAX_BATCH_SIZE.min) return false;
  if (config.HEARTBEAT_INTERVAL_MS < SSE_BOUNDS.HEARTBEAT_INTERVAL_MS.min) return false;
  return true;
}
