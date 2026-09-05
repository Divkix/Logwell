import { z } from "zod";

const PROJECT_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export const projectCreatePayloadSchema = z.object({
  name: z
    .string()
    .min(1, "Project name cannot be empty")
    .max(50, "Project name cannot exceed 50 characters")
    .regex(
      PROJECT_NAME_PATTERN,
      "Project name must contain only alphanumeric characters, hyphens, and underscores",
    ),
});

export const projectUpdatePayloadSchema = z.object({
  name: z
    .string()
    .min(1, "Project name cannot be empty")
    .max(50, "Project name cannot exceed 50 characters")
    .regex(
      PROJECT_NAME_PATTERN,
      "Project name must contain only alphanumeric characters, hyphens, and underscores",
    )
    .optional(),
  retentionDays: z.union([z.null(), z.literal(0), z.number().int().min(1).max(3650)]).optional(),
});
