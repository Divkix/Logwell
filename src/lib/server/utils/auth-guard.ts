import type { RequestEvent } from "@sveltejs/kit";
import { error, redirect } from "@sveltejs/kit";
import type { Session, User } from "../auth";

/**
 * Result of successful authentication check
 * Returns non-optional user and session types for type safety in protected routes
 */
export interface AuthenticatedSession {
  user: User;
  session: Session;
}

/**
 * Check if a route is an API route based on its route ID
 */
function isApiRoute(routeId: string | null): boolean {
  return routeId?.startsWith("/api/") ?? false;
}

/**
 * Requires authenticated session for protected routes
 *
 * Checks if the request has a valid authenticated session via event.locals.
 * If not authenticated:
 *   - For API routes: throws a JSON 401 error
 *   - For page routes: throws a redirect to /login
 * If authenticated, returns the user and session with guaranteed non-optional types.
 *
 * @param event - SvelteKit RequestEvent from load function or action
 * @returns Promise resolving to { user, session } with non-optional types
 * @throws Redirect to /login if not authenticated (page routes)
 * @throws JSON 401 error if not authenticated (API routes)
 *
 * @example
 * // In +page.server.ts or +layout.server.ts
 * export async function load(event) {
 *   const { user, session } = await requireAuth(event);
 *   // user and session are guaranteed to be defined here
 *   return { user };
 * }
 */
export async function requireAuth(event: RequestEvent): Promise<AuthenticatedSession> {
  const { user, session } = event.locals;

  if (!user || !session) {
    if (isApiRoute(event.route.id)) {
      throw error(401, { message: "Unauthorized" });
    }
    throw redirect(303, "/login");
  }

  return { user, session };
}
