import { json } from "@sveltejs/kit";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDbClient } from "$lib/server/db/db";
import { log, project } from "$lib/server/db/schema";
import { apiError } from "$lib/server/utils/api-error";
import { generateApiKey, hashApiKey } from "$lib/server/utils/api-key";
import { requireAuth } from "$lib/server/utils/auth-guard";
import { requireJsonContentType } from "$lib/server/utils/content-type";
import { checkCsrfOrigin } from "$lib/server/utils/csrf";
import { projectCreatePayloadSchema } from "$lib/shared/schemas/project";
import type { RequestEvent } from "./$types";

/**
 * GET /api/projects
 *
 * Returns all projects owned by the authenticated user with their log counts.
 * Requires session authentication.
 *
 * Response:
 * {
 *   projects: [{
 *     id: string,
 *     name: string,
 *     logCount: number,
 *     createdAt: string,
 *     updatedAt: string
 *   }]
 * }
 *
 * Note: API keys are NOT included in list response for security.
 */
export async function GET(event: RequestEvent): Promise<Response> {
  const { user } = await requireAuth(event);

  const db = await getDbClient(event.locals);

  const projects = await db
    .select({
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    })
    .from(project)
    .where(eq(project.ownerId, user.id))
    .orderBy(desc(project.createdAt));

  const projectIds = projects.map((p) => p.id);
  const logCounts =
    projectIds.length > 0
      ? await db
          .select({ projectId: log.projectId, count: count() })
          .from(log)
          .where(inArray(log.projectId, projectIds))
          .groupBy(log.projectId)
      : [];
  const logCountByProject = new Map(logCounts.map((c) => [c.projectId, c.count]));

  const projectsWithCounts = projects.map((p) => ({
    id: p.id,
    name: p.name,
    logCount: logCountByProject.get(p.id) ?? 0,
    createdAt: p.createdAt?.toISOString(),
    updatedAt: p.updatedAt?.toISOString(),
  }));

  return json({ projects: projectsWithCounts });
}

/**
 * POST /api/projects
 *
 * Creates a new project with auto-generated API key.
 * The authenticated user becomes the owner.
 * Requires session authentication.
 *
 * Request body:
 * {
 *   name: string  // 1-50 chars, alphanumeric with hyphens/underscores
 * }
 *
 * Response (201):
 * {
 *   id: string,
 *   name: string,
 *   apiKey: string,
 *   createdAt: string,
 *   updatedAt: string
 * }
 *
 * Error responses:
 * - 400 validation_error: Invalid name format
 * - 400 duplicate_name: Project name already exists
 */
export async function POST(event: RequestEvent): Promise<Response> {
  const csrfError = checkCsrfOrigin(event);
  if (csrfError) return csrfError;

  const contentTypeError = requireJsonContentType(event.request);
  if (contentTypeError) return contentTypeError;

  const { user } = await requireAuth(event);

  const db = await getDbClient(event.locals);

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return apiError(400, "invalid_json", "Invalid JSON body");
  }

  const validation = projectCreatePayloadSchema.safeParse(body);
  if (!validation.success) {
    const issues = validation.error.issues ?? [];
    const firstError = issues[0];
    const field = firstError?.path.join(".") || "name";
    const message = firstError?.message || "Validation failed";

    return apiError(400, "validation_error", `${field}: ${message}`);
  }

  const { name } = validation.data;

  const [existing] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.name, name), eq(project.ownerId, user.id)));

  if (existing) {
    return apiError(400, "duplicate_name", "A project with this name already exists");
  }

  const generatedApiKey = generateApiKey();
  const newProject = {
    id: nanoid(),
    name,
    apiKeyHash: hashApiKey(generatedApiKey),
    ownerId: user.id,
  };

  const [created] = await db.insert(project).values(newProject).returning();
  if (!created) return apiError(500, "internal_error", "Failed to create project");

  return json(
    {
      id: created.id,
      name: created.name,
      apiKey: generatedApiKey,
      createdAt: created.createdAt?.toISOString(),
      updatedAt: created.updatedAt?.toISOString(),
    },
    { status: 201 },
  );
}
