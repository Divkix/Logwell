/**
 * Performance configuration module for Logwell.
 *
 * This module centralizes all performance-related configuration parameters,
 * making them configurable via environment variables while providing
 * sensible defaults and validation.
 *
 * Configuration can be overridden via environment variables:
 * - SSE_BATCH_WINDOW_MS: Time window for batching SSE events (default: 1500ms)
 * - SSE_MAX_BATCH_SIZE: Maximum logs per batch before flush (default: 50)
 * - SSE_HEARTBEAT_INTERVAL_MS: Heartbeat interval (default: 30000ms, capped at half IDLE_TIMEOUT)
 * - LOG_STREAM_MAX_LOGS: Maximum logs in memory per client (default: 1000)
 * - LOG_RETENTION_DAYS: System default retention in days (default: 30, 0 = disabled)
 * - LOG_CLEANUP_INTERVAL_MS: Cleanup job interval in ms (default: 3600000 = 1 hour)
 * - INCIDENT_AUTO_RESOLVE_MINUTES: Minutes before incident is considered resolved (default: 30)
 */

/**
 * Parses an environment variable as an exact integer.
 *
 * Strict by design: `Number.parseInt` accepts a numeric prefix, so "6 months" would silently
 * become 6 and "30s" 30 — a different unit than the operator wrote. Anything that is not a whole
 * number falls back to defaultValue, logging the value used instead.
 */
export function parseEnvInt(key: string, defaultValue: number): number {
  const value = process.env[key]?.trim();
  if (!value) {
    return defaultValue;
  }
  if (!/^\d+$/.test(value)) {
    console.warn(`[config] invalid ${key}="${value}", using default ${defaultValue}`);
    return defaultValue;
  }
  return Number(value);
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

// svelte-adapter-bun reads this straight into Bun.serve's idleTimeout (seconds), defaulting to 10
// exactly as build/index.js does. Bun closes a connection idle for that long, so the SSE heartbeat
// MUST land inside it — the heartbeat below is capped at half this value (jitter headroom).
const SERVER_IDLE_TIMEOUT_MS = parseEnvInt("IDLE_TIMEOUT", 10) * 1000;

// The cap must also lower the heartbeat floor: for IDLE_TIMEOUT <= 10s the floor (5s) would
// otherwise win the clamp and leave a heartbeat that arrives no earlier than the idle timeout.
// Never below 1000ms so an idle timeout of 0 (Bun: disabled) cannot become a 0ms hot loop.
const HEARTBEAT_MAX_MS = Math.max(
  1000,
  Math.min(SSE_BOUNDS.HEARTBEAT_INTERVAL_MS.max, Math.floor(SERVER_IDLE_TIMEOUT_MS / 2)),
);

/**
 * SSE (Server-Sent Events) streaming configuration.
 *
 * - BATCH_WINDOW_MS: Time window to batch logs before sending (reduces network overhead)
 * - MAX_BATCH_SIZE: Maximum logs per batch (flush immediately when reached)
 * - HEARTBEAT_INTERVAL_MS: Keep-alive ping interval (prevents connection timeout)
 */
export const SSE_CONFIG = {
  BATCH_WINDOW_MS: clamp(
    parseEnvInt("SSE_BATCH_WINDOW_MS", SSE_DEFAULTS.BATCH_WINDOW_MS),
    SSE_BOUNDS.BATCH_WINDOW_MS.min,
    SSE_BOUNDS.BATCH_WINDOW_MS.max,
  ),
  MAX_BATCH_SIZE: clamp(
    parseEnvInt("SSE_MAX_BATCH_SIZE", SSE_DEFAULTS.MAX_BATCH_SIZE),
    SSE_BOUNDS.MAX_BATCH_SIZE.min,
    SSE_BOUNDS.MAX_BATCH_SIZE.max,
  ),
  HEARTBEAT_INTERVAL_MS: clamp(
    parseEnvInt("SSE_HEARTBEAT_INTERVAL_MS", SSE_DEFAULTS.HEARTBEAT_INTERVAL_MS),
    Math.min(SSE_BOUNDS.HEARTBEAT_INTERVAL_MS.min, HEARTBEAT_MAX_MS),
    HEARTBEAT_MAX_MS,
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
    parseEnvInt("LOG_STREAM_MAX_LOGS", LOG_STREAM_DEFAULTS.DEFAULT_MAX_LOGS),
    1,
    LOG_STREAM_DEFAULTS.MAX_LOGS_UPPER_LIMIT,
  ),
} as const;

// Retention Configuration defaults and bounds
const RETENTION_DEFAULTS = {
  LOG_RETENTION_DAYS: 30,
  LOG_CLEANUP_INTERVAL_MS: 3600000, // 1 hour
} as const;

const RETENTION_BOUNDS = {
  LOG_RETENTION_DAYS: { min: 0, max: 3650 }, // 0 = disabled, max 10 years
  LOG_CLEANUP_INTERVAL_MS: { min: 60000, max: 86400000 }, // 1 minute to 24 hours
} as const;

/**
 * Resolves LOG_RETENTION_DAYS, the one knob where a wrong value either deletes logs early or
 * disables deletion entirely, so it is resolved explicitly instead of clamped — clamping an
 * out-of-range value can only land on a bound, and the lower bound (0) means "never delete".
 * Unparsable and negative values already fall back to the documented default inside parseEnvInt;
 * only an explicit 0 disables cleanup.
 */
function parseRetentionDays(): number {
  const max = RETENTION_BOUNDS.LOG_RETENTION_DAYS.max;
  const days = parseEnvInt("LOG_RETENTION_DAYS", RETENTION_DEFAULTS.LOG_RETENTION_DAYS);
  if (days <= max) {
    return days;
  }
  // Above the documented maximum: clamp towards keeping logs, never towards deleting them.
  console.warn(`[config] LOG_RETENTION_DAYS=${days} exceeds ${max}, using ${max}`);
  return max;
}

/**
 * Log retention and cleanup configuration.
 *
 * - LOG_RETENTION_DAYS: System default retention period in days (0 = disabled)
 * - LOG_CLEANUP_INTERVAL_MS: Cleanup job interval in milliseconds
 */
export const RETENTION_CONFIG = {
  LOG_RETENTION_DAYS: parseRetentionDays(),
  LOG_CLEANUP_INTERVAL_MS: clamp(
    parseEnvInt("LOG_CLEANUP_INTERVAL_MS", RETENTION_DEFAULTS.LOG_CLEANUP_INTERVAL_MS),
    RETENTION_BOUNDS.LOG_CLEANUP_INTERVAL_MS.min,
    RETENTION_BOUNDS.LOG_CLEANUP_INTERVAL_MS.max,
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

// Incident configuration defaults and bounds
const INCIDENT_DEFAULTS = {
  AUTO_RESOLVE_MINUTES: 30,
} as const;

const INCIDENT_BOUNDS = {
  AUTO_RESOLVE_MINUTES: { min: 1, max: 10080 }, // 1 minute to 7 days
} as const;

/**
 * Incident configuration.
 *
 * - AUTO_RESOLVE_MINUTES: Minutes without new matching errors before an incident is considered resolved
 */
export const INCIDENT_CONFIG = {
  AUTO_RESOLVE_MINUTES: clamp(
    parseEnvInt("INCIDENT_AUTO_RESOLVE_MINUTES", INCIDENT_DEFAULTS.AUTO_RESOLVE_MINUTES),
    INCIDENT_BOUNDS.AUTO_RESOLVE_MINUTES.min,
    INCIDENT_BOUNDS.AUTO_RESOLVE_MINUTES.max,
  ),
} as const;
