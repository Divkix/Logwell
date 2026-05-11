import { json } from '@sveltejs/kit';
import { and, count, eq, ne } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '$lib/server/db/schema';
import { log, project } from '$lib/server/db/schema';
import { invalidateApiKeyCache } from '$lib/server/utils/api-key';
import { checkCsrfOrigin } from '$lib/server/utils/csrf';
import { isErrorResponse, requireProjectOwnership } from '$lib/server/utils/project-guard';
import { projectUpdatePayloadSchema } from '$lib/shared/schemas/project';
import type { RequestEvent } from './$types';

type DatabaseClient = PostgresJsDatabase<typeof schema> | PgliteDatabase<typeof schema>;

/**
 * Helper to get database client from locals or production db
 * Supports test injection via locals.db
 */
async function getDbClient(locals: App.Locals): Promise<DatabaseClient> {
  if (locals.db) {
    return locals.db as DatabaseClient;
  }
  const { db } = await import('$lib/server/db');
  return db;
}

/**
 * GET /api/projects/[id]
 *
 * Returns a single project with its stats including log count and level distribution.
 * Requires session authentication and project ownership.
 *
 * Response:
 * {
 *   id: string,
 *   name: string,
 *   apiKey: string,
 *   retentionDays: number | null,
 *   createdAt: string,
 *   updatedAt: string,
 *   stats: {
 *     totalLogs: number,
 *     levelCounts: {
 *       debug?: number,
 *       info?: number,
 *       warn?: number,
 *       error?: number,
 *       fatal?: number
 *     }
 *   }
 * }
 *
 * Error responses:
 * - 404 not_found: Project does not exist or not owned by user
 */
export async function GET(event: RequestEvent): Promise<Response> {
  // Require authentication and project ownership
  const result = await requireProjectOwnership(event, event.params.id);
  if (isErrorResponse(result)) return result;

  const { project: projectData } = result;
  const db = await getDbClient(event.locals);
  const projectId = event.params.id;

  // Get total log count
  const [logCountResult] = await db
    .select({ count: count() })
    .from(log)
    .where(eq(log.projectId, projectId));

  // Get level distribution
  const levelCounts = await db
    .select({
      level: log.level,
      count: count(),
    })
    .from(log)
    .where(eq(log.projectId, projectId))
    .groupBy(log.level);

  // Convert level counts to object
  const levelCountsObj: Record<string, number> = {};
  for (const { level, count: levelCount } of levelCounts) {
    if (level) {
      levelCountsObj[level] = levelCount;
    }
  }

  return json({
    id: projectData.id,
    name: projectData.name,
    apiKey: projectData.apiKey,
    retentionDays: projectData.retentionDays,
    createdAt: projectData.createdAt?.toISOString(),
    updatedAt: projectData.updatedAt?.toISOString(),
    stats: {
      totalLogs: logCountResult?.count ?? 0,
      levelCounts: levelCountsObj,
    },
  });
}

/**
 * PATCH /api/projects/[id]
 *
 * Updates a project's editable fields (name, retentionDays).
 * Requires session authentication and project ownership.
 *
 * Request body:
 * {
 *   name?: string  // Optional. Must be unique, 1-50 chars, alphanumeric with hyphens/underscores
 *   retentionDays?: number | null  // Optional. null = system default, 0 = never delete, 1-3650 = days
 * }
 *
 * Response:
 * {
 *   id: string,
 *   name: string,
 *   apiKey: string,
 *   retentionDays: number | null,
 *   createdAt: string,
 *   updatedAt: string
 * }
 *
 * Error responses:
 * - 400 validation_error: Invalid name format or retentionDays value
 * - 400 duplicate_name: Name already in use by another project
 * - 404 not_found: Project does not exist or not owned by user
 */
export async function PATCH(event: RequestEvent): Promise<Response> {
  // CSRF protection for state-changing request
  const csrfError = checkCsrfOrigin(event);
  if (csrfError) return csrfError;

  // Require authentication and project ownership
  const authResult = await requireProjectOwnership(event, event.params.id);
  if (isErrorResponse(authResult)) return authResult;

  const db = await getDbClient(event.locals);
  const projectId = event.params.id;

  // Parse request body
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid_json', message: 'Invalid JSON body' }, { status: 400 });
  }

  // Validate request body
  const result = projectUpdatePayloadSchema.safeParse(body);
  if (!result.success) {
    const errorMessage = result.error.issues?.[0]?.message || 'Validation failed';
    return json({ code: 'validation_error', message: errorMessage }, { status: 400 });
  }

  const { name, retentionDays } = result.data;

  // Check for duplicate name (if name is being updated)
  if (name) {
    const existing = await db.query.project.findFirst({
      where: and(eq(project.name, name), ne(project.id, projectId)),
    });
    if (existing) {
      return json(
        { code: 'duplicate_name', message: 'A project with this name already exists' },
        { status: 400 },
      );
    }
  }

  // Build update object dynamically to only include provided fields
  const updateData: { name?: string; retentionDays?: number | null; updatedAt: Date } = {
    updatedAt: new Date(),
  };

  if (name !== undefined) {
    updateData.name = name;
  }

  if (retentionDays !== undefined) {
    updateData.retentionDays = retentionDays;
  }

  // Update project (ownership already verified)
  const [updated] = await db
    .update(project)
    .set(updateData)
    .where(eq(project.id, projectId))
    .returning();

  if (!updated) {
    return json({ code: 'not_found', message: 'Project not found' }, { status: 404 });
  }

  return json({
    id: updated.id,
    name: updated.name,
    apiKey: updated.apiKey,
    retentionDays: updated.retentionDays,
    createdAt: updated.createdAt?.toISOString(),
    updatedAt: updated.updatedAt?.toISOString(),
  });
}

/**
 * DELETE /api/projects/[id]
 *
 * Deletes a project and all associated logs (via cascade).
 * Also invalidates the project's API key from cache.
 * Requires session authentication and project ownership.
 *
 * Response:
 * {
 *   success: true,
 *   id: string  // deleted project id
 * }
 *
 * Error responses:
 * - 404 not_found: Project does not exist or not owned by user
 */
export async function DELETE(event: RequestEvent): Promise<Response> {
  // CSRF protection for state-changing request
  const csrfError = checkCsrfOrigin(event);
  if (csrfError) return csrfError;

  // Require authentication and project ownership
  const authResult = await requireProjectOwnership(event, event.params.id);
  if (isErrorResponse(authResult)) return authResult;

  const { project: projectData } = authResult;
  const db = await getDbClient(event.locals);
  const projectId = event.params.id;

  // Delete project (logs will cascade delete via FK constraint)
  await db.delete(project).where(eq(project.id, projectId));

  // Invalidate API key cache
  invalidateApiKeyCache(projectData.apiKey);

  return json({
    success: true,
    id: projectId,
  });
}
