import { z } from "zod";

export const LOG_LEVELS = ["debug", "info", "warn", "error", "fatal"] as const;

export const logLevelSchema = z.enum(LOG_LEVELS);

/**
 * Longest accepted full-text `search` filter, in characters. Each term becomes one tsquery
 * operand, so the cap bounds query-planning cost; the API answers longer input with 400.
 */
export const MAX_SEARCH_LENGTH = 256;

export type LogLevel = z.infer<typeof logLevelSchema>;

export function parseLevelFilter(levelParam: string | null): LogLevel[] | null {
  if (!levelParam) return null;

  const levels = levelParam
    .split(",")
    .map((l) => l.trim().toLowerCase())
    .filter((l): l is LogLevel => logLevelSchema.safeParse(l).success);

  return levels.length > 0 ? levels : null;
}
