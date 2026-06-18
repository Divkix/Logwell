import { z } from "zod";

/**
 * Valid log levels
 */
export const LOG_LEVELS = ["debug", "info", "warn", "error", "fatal"] as const;

/**
 * Log level schema
 */
export const logLevelSchema = z.enum(LOG_LEVELS);

/**
 * Log level type
 */
export type LogLevel = z.infer<typeof logLevelSchema>;

/**
 * Parse and validate level filter from a query-string parameter.
 * Accepts a comma-separated list of level names (case-insensitive).
 * Returns an array of valid LogLevel values, or null if the param is
 * absent, empty, or contains no recognised values.
 */
export function parseLevelFilter(levelParam: string | null): LogLevel[] | null {
  if (!levelParam) return null;

  const levels = levelParam
    .split(",")
    .map((l) => l.trim().toLowerCase())
    .filter((l): l is LogLevel => LOG_LEVELS.includes(l as LogLevel));

  return levels.length > 0 ? levels : null;
}
