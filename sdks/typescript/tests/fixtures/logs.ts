import type { LogEntry, LogLevel } from "../../src/types";

/**
 * Creates a log entry fixture with optional overrides
 */
export function createLogFixture(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    level: "info",
    message: `Test log message ${Date.now()}`,
    ...overrides,
  };
}

/**
 * Creates an array of log entry fixtures
 */
export function createLogBatch(count: number, overrides: Partial<LogEntry> = {}): LogEntry[] {
  return Array.from({ length: count }, (_, i) =>
    createLogFixture({
      message: `Batch log ${i + 1}`,
      ...overrides,
    }),
  );
}

/**
 * Pre-defined log fixtures for specific test scenarios
 */
export const logFixtures = {
  minimal: {
    level: "info" as LogLevel,
    message: "minimal log",
  },

  full: {
    level: "error" as LogLevel,
    message: "Full log with all fields",
    timestamp: "2025-01-05T12:00:00.000Z",
    service: "test-service",
    metadata: {
      key: "value",
      nested: { deep: true },
      count: 42,
    },
  },

  debug: {
    level: "debug" as LogLevel,
    message: "Debug message",
  },

  info: {
    level: "info" as LogLevel,
    message: "Info message",
  },

  warn: {
    level: "warn" as LogLevel,
    message: "Warning message",
  },

  error: {
    level: "error" as LogLevel,
    message: "Error message",
    metadata: { errorCode: "ERR_001" },
  },

  fatal: {
    level: "fatal" as LogLevel,
    message: "Fatal error occurred",
    metadata: { stack: "Error stack trace" },
  },

  withLargeMetadata: {
    level: "info" as LogLevel,
    message: "Log with large metadata",
    metadata: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`key_${i}`, `value_${i}`])),
  },

  withUnicode: {
    level: "info" as LogLevel,
    message: "Unicode: \u4e2d\u6587 \u{1F600} \u0391\u03B2\u03B3",
  },

  withLongMessage: {
    level: "warn" as LogLevel,
    message: "A".repeat(10000),
  },

  withSpecialChars: {
    level: "info" as LogLevel,
    message: "Special: \"quotes\" 'apostrophe' <tags> & ampersand",
  },
};

/**
 * All log levels for parametrized testing
 */
export const allLogLevels: LogLevel[] = ["debug", "info", "warn", "error", "fatal"];
