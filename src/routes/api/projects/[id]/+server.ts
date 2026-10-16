import { and, eq, ne } from "drizzle-orm";
import { project, type Project } from "#lib/server/db/schema.js";
import { apiError, isUniqueViolation } from "#lib/server/utils/api-error.js";
import { invalidateApiKeyCacheByHash } from "#lib/server/utils/api-key.js";
import { recentLevelCounts } from "#lib/server/utils/capped-count.js";
import { requireJsonContentType } from "#lib/server/utils/content-type.js";
import { requireOwnedProjectRoute } from "#lib/server/utils/owned-project.js";
import { projectUpdatePayloadSchema } from "#lib/shared/schemas/project.js";
import type { RequestEvent } from "./$types";

/**
 * GET /api/projects/[id]
 *
 * Returns a single project with its stats including log count and level distribution.
 * Requires session authentication and project ownership.
 *
 * Stats cover at most the project's 10,000 most recent logs (LOG_COUNT_CEILING): below that
 * they are exact; at it `totalLogs` is 10000, `totalLogsCapped` is true and `levelCounts`
 * describes those most recent logs. Use /stats with a time window for exact counts.
 *
 * Response:
 * {
 *   id: string,
 *   name: string,
 *   retentionDays: number | null,
 *   createdAt: string,
 *   updatedAt: string,
 *   stats: {
 *     totalLogs: number,         // capped at 10000
 *     totalLogsCapped: boolean,
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
  const result = await requireOwnedProjectRoute(event, event.params.id);

  if (result instanceof Response) return result;

  const { project: projectData, db } = result;
  const projectId = event.params.id;

  const { total, capped, levelCounts } = await recentLevelCounts(db, projectId);

  return Response.json({
    id: projectData.id,
    name: projectData.name,
    retentionDays: projectData.retentionDays,
    createdAt: projectData.createdAt?.toISOString(),
    updatedAt: projectData.updatedAt?.toISOString(),
    stats: {
      totalLogs: total,
      totalLogsCapped: capped,
      levelCounts,
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
  const contentTypeError = requireJsonContentType(event.request);

  if (contentTypeError) return contentTypeError;

  const authResult = await requireOwnedProjectRoute(event, event.params.id);

  if (authResult instanceof Response) return authResult;

  const { db } = authResult;
  const projectId = event.params.id;

  let body: unknown;

  try {
    body = await event.request.json();
  } catch {
    return Response.json({ error: "invalid_json", message: "Invalid JSON body" }, { status: 400 });
  }

  const result = projectUpdatePayloadSchema.safeParse(body);

  if (!result.success) {
    const errorMessage = result.error.issues?.[0]?.message || "Validation failed";

    return apiError(400, "validation_error", errorMessage);
  }

  const { name, retentionDays } = result.data;
  const { project: currentProject } = authResult;

  if (name) {
    const existing = await db.query.project.findFirst({
      where: and(
        eq(project.name, name),
        ne(project.id, projectId),
        eq(project.ownerId, currentProject.ownerId),
      ),
    });

    if (existing) {
      return apiError(400, "duplicate_name", "A project with this name already exists");
    }
  }

  if (name === undefined && retentionDays === undefined) {
    return Response.json({
      id: currentProject.id,
      name: currentProject.name,
      retentionDays: currentProject.retentionDays,
      createdAt: currentProject.createdAt?.toISOString(),
      updatedAt: currentProject.updatedAt?.toISOString(),
    });
  }

  type ProjectUpdatePatch = { name?: string; retentionDays?: number | null; updatedAt?: Date };

  const updateData: ProjectUpdatePatch = {};

  if (name !== undefined) {
    updateData.name = name;
  }

  if (retentionDays !== undefined) {
    updateData.retentionDays = retentionDays;
  }

  if (updateData.name !== undefined || updateData.retentionDays !== undefined) {
    updateData.updatedAt = new Date();
  }

  let updated: Project | undefined;

  try {
    [updated] = await db
      .update(project)
      .set(updateData)
      .where(eq(project.id, projectId))
      .returning();
  } catch (error) {
    if (isUniqueViolation(error, "uq_project_name_owner")) {
      return apiError(400, "duplicate_name", "A project with this name already exists");
    }

    throw error;
  }

  if (!updated) {
    return apiError(404, "not_found", "Project not found");
  }

  return Response.json({
    id: updated.id,
    name: updated.name,
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
  const authResult = await requireOwnedProjectRoute(event, event.params.id);

  if (authResult instanceof Response) return authResult;

  const { project: projectData, db } = authResult;
  const projectId = event.params.id;

  invalidateApiKeyCacheByHash(projectData.apiKeyHash);

  await db.delete(project).where(eq(project.id, projectId));

  return Response.json({
    success: true,
    id: projectId,
  });
}
