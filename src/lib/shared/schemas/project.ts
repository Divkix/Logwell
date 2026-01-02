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
