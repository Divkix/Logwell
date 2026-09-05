import { z } from "zod";

export const LOG_LEVELS = ["debug", "info", "warn", "error", "fatal"] as const;

export const logLevelSchema = z.enum(LOG_LEVELS);

export type LogLevel = z.infer<typeof logLevelSchema>;

export function parseLevelFilter(levelParam: string | null): LogLevel[] | null {
  if (!levelParam) return null;

  const levels = levelParam
    .split(",")
    .map((l) => l.trim().toLowerCase())
    .filter((l): l is LogLevel => LOG_LEVELS.includes(l as LogLevel));

  return levels.length > 0 ? levels : null;
}
