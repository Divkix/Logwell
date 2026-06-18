import { error, json, type RequestEvent } from "@sveltejs/kit";
import { and, eq } from "drizzle-orm";
import { getDbClient } from "$lib/server/db/db";
import { type Project, project } from "$lib/server/db/schema";
import { type AuthenticatedSession, requireAuth } from "./auth-guard";

/**
 * Result of successful project ownership check
 */
export interface AuthorizedProject extends AuthenticatedSession {
  project: Project;
}

/**
 * Shared ownership query used by both API and page-loader helpers.
 * Performs auth + DB lookup and returns raw results so each wrapper
 * can decide how to signal failure (JSON 404 vs SvelteKit error page).
 */
async function findOwnedProject(
  event: RequestEvent,
  projectId: string,
): Promise<{
  projectData: Project | undefined;
  user: AuthenticatedSession["user"];
  session: AuthenticatedSession["session"];
}> {
  const { user, session } = await requireAuth(event);
  const db = await getDbClient(event.locals);
  const [projectData] = await db
    .select()
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.ownerId, user.id)));
  return { projectData, user, session };
}

/**
 * Requires project ownership for API routes.
 *
 * Checks if the authenticated user owns the specified project.
 * If not authenticated, throws a redirect to /login.
 * If project not found or not owned by user, returns a 404 JSON response
 * (correct for API/fetch clients).
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
  const { projectData, user, session } = await findOwnedProject(event, projectId);

  if (!projectData) {
    // Return 404 to hide existence from non-owners
    return json({ error: "not_found", message: "Project not found" }, { status: 404 });
  }

  return { project: projectData, user, session };
}

/**
 * Requires project ownership for page loaders.
 *
 * Identical ownership check to `requireProjectOwnership`, but signals
 * failure by throwing a SvelteKit `error(404, ...)` so the error PAGE
 * is rendered (not a JSON blob). Use this in `+page.server.ts` loaders.
 *
 * @param event - SvelteKit RequestEvent from load function or action
 * @param projectId - The project ID to check ownership for
 * @returns Promise resolving to { project, user, session }
 * @throws SvelteKit 404 error page if project not found or not owned by user
 * @throws Redirect to /login if not authenticated
 */
export async function requireProjectOwnershipPage(
  event: RequestEvent,
  projectId: string,
): Promise<AuthorizedProject> {
  const { projectData, user, session } = await findOwnedProject(event, projectId);

  if (!projectData) {
    throw error(404, { message: "Project not found" });
  }

  return { project: projectData, user, session };
}

/**
 * Type guard to check if result is a Response (error case)
 */
export function isErrorResponse(result: AuthorizedProject | Response): result is Response {
  return result instanceof Response;
}
