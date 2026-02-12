import { z } from 'zod';

/**
 * Project name regex pattern
 * Allows alphanumeric characters, hyphens, and underscores
 */
const PROJECT_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Project create payload schema for POST /api/projects
 *
 * Name must be:
 * - Non-empty
 * - 1-50 characters
 * - Alphanumeric with hyphens and underscores only
 */
export const projectCreatePayloadSchema = z.object({
  name: z
    .string()
    .min(1, 'Project name cannot be empty')
    .max(50, 'Project name cannot exceed 50 characters')
    .regex(
      PROJECT_NAME_PATTERN,
      'Project name must contain only alphanumeric characters, hyphens, and underscores',
    ),
});

/**
 * Project update payload schema for PATCH /api/projects/[id]
 *
 * Name field is optional but must follow same rules as create when provided
 * retentionDays field is optional and can be:
 * - null: use system default
 * - 0: never delete logs
 * - 1-3650: delete logs after N days (max 10 years)
 */
export const projectUpdatePayloadSchema = z.object({
  name: z
    .string()
    .min(1, 'Project name cannot be empty')
    .max(50, 'Project name cannot exceed 50 characters')
    .regex(
      PROJECT_NAME_PATTERN,
      'Project name must contain only alphanumeric characters, hyphens, and underscores',
    )
    .optional(),
  retentionDays: z
    .union([
      z.null(), // System default
      z.literal(0), // Never delete
      z.number().int().min(1).max(3650), // 1 day to 10 years
    ])
    .optional(),
});
