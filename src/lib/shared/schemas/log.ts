import { z } from 'zod';

/**
 * Valid log levels
 */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'] as const;

/**
 * Maximum batch size for batch log ingestion
 */
const MAX_BATCH_SIZE = 100;

/**
 * Log level schema
 */
export const logLevelSchema = z.enum(LOG_LEVELS);

/**
 * Log level type
 */
export type LogLevel = z.infer<typeof logLevelSchema>;

/**
 * Single log payload schema for POST /api/v1/logs
 *
 * Transforms snake_case API input to camelCase for internal use
 */
export const logPayloadSchema = z
  .object({
    level: logLevelSchema,
    message: z.string().min(1, 'Message cannot be empty'),
    metadata: z.any().nullable().optional(),
    source_file: z.string().optional(),
    line_number: z.number().int().positive().optional(),
    request_id: z.string().optional(),
    user_id: z.string().optional(),
    ip_address: z.string().optional(),
    timestamp: z
      .string()
      .datetime()
      .transform((val) => new Date(val))
      .optional(),
  })
  .transform((data) => ({
    level: data.level,
    message: data.message,
    metadata: data.metadata,
    sourceFile: data.source_file,
    lineNumber: data.line_number,
    requestId: data.request_id,
    userId: data.user_id,
    ipAddress: data.ip_address,
    timestamp: data.timestamp,
  }));

/**
 * Batch log payload schema for POST /api/v1/logs/batch
 *
 * Validates array of logs with min 1 and max 100 items
 */
export const batchLogPayloadSchema = z.object({
  logs: z
    .array(logPayloadSchema)
    .min(1, 'Batch must contain at least one log')
    .max(MAX_BATCH_SIZE, `Batch cannot exceed ${MAX_BATCH_SIZE} logs`),
});
