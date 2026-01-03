import { z } from 'zod';

/**
 * Valid log levels
 */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'] as const;

/**
 * Log level schema
 */
export const logLevelSchema = z.enum(LOG_LEVELS);

/**
 * Log level type
 */
export type LogLevel = z.infer<typeof logLevelSchema>;
