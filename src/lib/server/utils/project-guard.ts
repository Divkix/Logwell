import { json, type RequestEvent } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { getDbClient } from '$lib/server/db/db';
import { type Project, project } from '$lib/server/db/schema';
import { type AuthenticatedSession, requireAuth } from './auth-guard';

/**
 * Result of successful project ownership check
 */
export interface AuthorizedProject extends AuthenticatedSession {
  project: Project;
}

/**
 * Requires project ownership for protected routes
 *
 * Checks if the authenticated user owns the specified project.
 * If not authenticated, throws a redirect to /login.
 * If project not found or not owned by user, returns a 404 JSON response.
 *
 * @param event - SvelteKit RequestEvent from load function or action
 * @param projectId - The project ID to check ownership for
 * @returns Promise resolving to { project, user, session } or 404 Response
 * @throws Redirect to /login if not authenticated
 *
 * @example
 * // In API route
 * export async function GET(event) {
 *   const result = await requireProjectOwnership(event, event.params.id);
 *   if (result instanceof Response) return result; // 404
 *   const { project, user } = result;
 *   // User owns this project
 * }
 */
export async function requireProjectOwnership(
  event: RequestEvent,
  projectId: string,
): Promise<AuthorizedProject | Response> {
  // First, require authentication
  const { user, session } = await requireAuth(event);

  const db = await getDbClient(event.locals);

  // Query project with ownership check
  const [projectData] = await db
    .select()
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.ownerId, user.id)));

  if (!projectData) {
    // Return 404 to hide existence from non-owners
    return json({ error: 'not_found', message: 'Project not found' }, { status: 404 });
  }

  return { project: projectData, user, session };
}

/**
 * Type guard to check if result is a Response (error case)
 */
export function isErrorResponse(result: AuthorizedProject | Response): result is Response {
  return result instanceof Response;
}
