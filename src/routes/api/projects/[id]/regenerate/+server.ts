import { json } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import { project } from "$lib/server/db/schema";
import { generateApiKey, hashApiKey, invalidateApiKeyCacheByHash } from "$lib/server/utils/api-key";
import { requireOwnedProjectRoute } from "$lib/server/utils/owned-project";
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
 * - 404 not_found: Project does not exist or not owned by user
 */
export async function POST(event: RequestEvent): Promise<Response> {
  const authResult = await requireOwnedProjectRoute(event, event.params.id);

  if (authResult instanceof Response) return authResult;

  const { project: projectData, db } = authResult;
  const projectId = event.params.id;

  const newApiKey = generateApiKey();

  invalidateApiKeyCacheByHash(projectData.apiKeyHash);

  await db
    .update(project)
    .set({
      apiKeyHash: hashApiKey(newApiKey),
      updatedAt: new Date(),
    })
    .where(eq(project.id, projectId));

  return json({
    apiKey: newApiKey,
  });
}
