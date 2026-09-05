import type { RequestEvent } from "@sveltejs/kit";
import { error, redirect } from "@sveltejs/kit";
import type { Session, User } from "../auth";

export interface AuthenticatedSession {
  user: User;
  session: Session;
}

function isApiRoute(routeId: string | null): boolean {
  return routeId?.startsWith("/api/") ?? false;
}

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
