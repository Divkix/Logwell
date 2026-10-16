import { and, eq } from "drizzle-orm";
import { isActiveProject } from "#lib/server/db/predicates.js";
import { project } from "#lib/server/db/schema.js";
import { apiError } from "#lib/server/utils/api-error.js";
import {
  generateApiKey,
  hashApiKey,
  invalidateApiKeyCacheByHash,
} from "#lib/server/utils/api-key.js";
import { requireOwnedProjectRoute } from "#lib/server/utils/owned-project.js";
import type { RequestEvent } from "./$types";

/**
 * POST /api/projects/[id]/regenerate
 *
 * Regenerates the API key for a project.
 * The old API key is immediately invalidated and a new one is generated.
 * Requires session authentication and project ownership.
 *
 * Response:
 * {
 *   apiKey: string  // the new API key
 * }
 *
 * Error responses:
 * - 404 not_found: Project does not exist, is deleted, or is not owned by user
 */
export async function POST(event: RequestEvent): Promise<Response> {
  const authResult = await requireOwnedProjectRoute(event, event.params.id);

  if (authResult instanceof Response) return authResult;

  const { project: projectData, db } = authResult;
  const projectId = event.params.id;

  const newApiKey = generateApiKey();

  // isActiveProject is re-checked here, not only in the guard: a DELETE committing between the
  // guard and this UPDATE would otherwise get a fresh, valid key written onto the deleted row.
  const [updated] = await db
    .update(project)
    .set({
      apiKeyHash: hashApiKey(newApiKey),
      updatedAt: new Date(),
    })
    .where(and(eq(project.id, projectId), isActiveProject))
    .returning();

  // After the commit, not before: a lookup landing between an early invalidation and the
  // UPDATE would re-cache the old hash. Lookups still in flight here are kept out of the cache
  // by the generation guard in validateApiKey, and ingest re-checks the hash per request.
  invalidateApiKeyCacheByHash(projectData.apiKeyHash);

  if (!updated) {
    return apiError(404, "not_found", "Project not found");
  }

  return Response.json({
    apiKey: newApiKey,
  });
}
