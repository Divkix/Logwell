import { error, json, redirect, type RequestEvent } from "@sveltejs/kit";
import { and, eq } from "drizzle-orm";
import { getDbClient, type DatabaseClient } from "$lib/server/db/db";
import { type Project, project } from "$lib/server/db/schema";
import type { Session, User } from "../auth";
import { checkCsrfOrigin } from "./csrf";

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

export interface OwnedProject {
  project: Project;
  db: DatabaseClient;
}

async function findOwnedProject(
  event: RequestEvent,
  projectId: string,
): Promise<{ projectData: Project | undefined; db: DatabaseClient }> {
  const { user } = await requireAuth(event);
  const db = await getDbClient(event.locals);
  const [projectData] = await db
    .select()
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.ownerId, user.id)));
  return { projectData, db };
}

export async function requireOwnedProjectRoute(
  event: RequestEvent,
  projectId: string,
): Promise<OwnedProject | Response> {
  const csrfError = checkCsrfOrigin(event);
  if (csrfError) return csrfError;

  const { projectData, db } = await findOwnedProject(event, projectId);

  if (!projectData) {
    return json({ error: "not_found", message: "Project not found" }, { status: 404 });
  }

  return { project: projectData, db };
}

export async function requireOwnedProjectPage(
  event: RequestEvent,
  projectId: string,
): Promise<OwnedProject> {
  const { projectData, db } = await findOwnedProject(event, projectId);

  if (!projectData) {
    throw error(404, { message: "Project not found" });
  }

  return { project: projectData, db };
}
