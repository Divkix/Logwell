import type { LogLevel } from '../db/schema';

/**
 * Valid log levels for simple ingestion API
 */
const VALID_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error', 'fatal'] as const;

/**
 * Input format for a single log entry from the simple API
 */
export interface SimpleLogInput {
  level: string;
  message: string;
  timestamp?: string;
  service?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Normalized log entry ready for database insertion
 */
export interface NormalizedSimpleLog {
  level: LogLevel;
  message: string;
  timestamp: Date;
  resourceAttributes: { 'service.name': string } | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Result of parsing and validating simple log input
 */
export interface SimpleIngestResult {
  records: NormalizedSimpleLog[];
  accepted: number;
  rejected: number;
  errors: string[];
}

/**
 * Custom error class for simple ingest validation errors
 */
export class SimpleIngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SimpleIngestError';
  }
}

/**
 * Validates that a value is a valid log level
 */
function isValidLevel(level: unknown): level is LogLevel {
  return typeof level === 'string' && VALID_LEVELS.includes(level as LogLevel);
}

/**
 * Parses an ISO8601 timestamp string to a Date object
 * Returns current date if timestamp is invalid or missing
 */
function parseTimestamp(timestamp: unknown): Date {
  if (!timestamp || typeof timestamp !== 'string') {
    return new Date();
  }

  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }

  return parsed;
}

/**
 * Validates and normalizes a single log entry
 * Returns the normalized log or null with an error message
 */
function validateLogEntry(
  input: unknown,
  index: number,
): { log: NormalizedSimpleLog; error: null } | { log: null; error: string } {
  if (!input || typeof input !== 'object') {
    return { log: null, error: `Entry at index ${index}: must be an object` };
  }

  const entry = input as Record<string, unknown>;

  // Validate level
  if (!('level' in entry)) {
    return { log: null, error: `Entry at index ${index}: missing required field 'level'` };
  }
  if (!isValidLevel(entry.level)) {
    return {
      log: null,
      error: `Entry at index ${index}: invalid level '${entry.level}' (must be one of: ${VALID_LEVELS.join(', ')})`,
    };
  }

  // Validate message
  if (!('message' in entry)) {
    return { log: null, error: `Entry at index ${index}: missing required field 'message'` };
  }
  if (typeof entry.message !== 'string') {
    return { log: null, error: `Entry at index ${index}: message must be a string` };
  }
  if (entry.message.trim() === '') {
    return { log: null, error: `Entry at index ${index}: message cannot be empty` };
  }

  // Parse optional fields
  const timestamp = parseTimestamp(entry.timestamp);
  const service = typeof entry.service === 'string' ? entry.service : null;
  const metadata =
    entry.metadata && typeof entry.metadata === 'object'
      ? (entry.metadata as Record<string, unknown>)
      : null;

  return {
    log: {
      level: entry.level as LogLevel,
      message: entry.message,
      timestamp,
      resourceAttributes: service ? { 'service.name': service } : null,
      metadata,
    },
    error: null,
  };
}

/**
 * Parses and validates the request body for simple log ingestion
 *
 * Accepts either:
 * - A single log object: { level: "info", message: "..." }
 * - An array of log objects: [{ level: "info", message: "..." }, ...]
 *
 * @param body - Parsed JSON body from the request
 * @returns Result with normalized logs and validation errors
 * @throws SimpleIngestError if body is completely invalid (not object or array)
 */
export function parseSimpleIngestRequest(body: unknown): SimpleIngestResult {
  if (body === null || body === undefined) {
    throw new SimpleIngestError('Request body cannot be empty');
  }

  // Normalize to array
  const entries = Array.isArray(body) ? body : [body];

  if (entries.length === 0) {
    throw new SimpleIngestError('Request body cannot be an empty array');
  }

  const records: NormalizedSimpleLog[] = [];
  const errors: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const result = validateLogEntry(entries[i], i);
    if (result.log) {
      records.push(result.log);
    } else {
      errors.push(result.error);
    }
  }

  return {
    records,
    accepted: records.length,
    rejected: errors.length,
    errors,
  };
}
