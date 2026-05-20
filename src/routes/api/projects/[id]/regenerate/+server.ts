import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDbClient } from '$lib/server/db/db';
import { project } from '$lib/server/db/schema';
import { generateApiKey, invalidateApiKeyCache } from '$lib/server/utils/api-key';
import { checkCsrfOrigin } from '$lib/server/utils/csrf';
import { isErrorResponse, requireProjectOwnership } from '$lib/server/utils/project-guard';
import type { RequestEvent } from './$types';

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
  // CSRF protection for state-changing request
  const csrfError = checkCsrfOrigin(event);
  if (csrfError) return csrfError;

  // Require authentication and project ownership
  const authResult = await requireProjectOwnership(event, event.params.id);
  if (isErrorResponse(authResult)) return authResult;

  const { project: projectData } = authResult;
  const db = await getDbClient(event.locals);
  const projectId = event.params.id;

  // Generate new API key
  const newApiKey = generateApiKey();

  // Update project with new API key
  await db
    .update(project)
    .set({
      apiKey: newApiKey,
      updatedAt: new Date(),
    })
    .where(eq(project.id, projectId));

  // Invalidate old API key cache
  invalidateApiKeyCache(projectData.apiKey);

  return json({
    apiKey: newApiKey,
  });
}
