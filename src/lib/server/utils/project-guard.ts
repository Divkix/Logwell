import { error, json, type RequestEvent } from "@sveltejs/kit";
import { and, eq } from "drizzle-orm";
import { getDbClient } from "$lib/server/db/db";
import { type Project, project } from "$lib/server/db/schema";
import { type AuthenticatedSession, requireAuth } from "./auth-guard";

export interface AuthorizedProject extends AuthenticatedSession {
  project: Project;
}

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

export async function requireProjectOwnership(
  event: RequestEvent,
  projectId: string,
): Promise<AuthorizedProject | Response> {
  const { projectData, user, session } = await findOwnedProject(event, projectId);

  if (!projectData) {
    return json({ error: "not_found", message: "Project not found" }, { status: 404 });
  }

  return { project: projectData, user, session };
}

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

export function isErrorResponse(result: AuthorizedProject | Response): result is Response {
  return result instanceof Response;
}
