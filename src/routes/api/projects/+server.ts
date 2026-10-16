import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDbClient } from "#lib/server/db/db.js";
import { project, type Project } from "#lib/server/db/schema.js";
import { apiError, isUniqueViolation } from "#lib/server/utils/api-error.js";
import { generateApiKey, hashApiKey } from "#lib/server/utils/api-key.js";
import { isCappedLogCount, projectLogStatsColumns } from "#lib/server/utils/capped-count.js";
import { isActiveProject, requireAuth } from "#lib/server/utils/owned-project.js";
import { requireJsonContentType } from "#lib/server/utils/content-type.js";
import { checkCsrfOrigin } from "#lib/server/utils/csrf.js";
import { projectCreatePayloadSchema } from "#lib/shared/schemas/project.js";
import type { RequestEvent } from "./$types";

/**
 * GET /api/projects
 *
 * Returns all projects owned by the authenticated user with their log counts.
 * Requires session authentication.
 *
 * Counts are capped at 10,000 (LOG_COUNT_CEILING): at the cap `logCount` is 10000 and
 * `logCountCapped` is true, meaning "at least 10,000".
 *
 * Response:
 * {
 *   projects: [{
 *     id: string,
 *     name: string,
 *     logCount: number,             // capped at 10000
 *     logCountCapped: boolean,
 *     lastActivity: string | null,  // newest log timestamp
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

  // One bounded statement: each count stops at LOG_COUNT_CEILING (an index range + LIMIT)
  // instead of a GROUP BY over every log the user's projects ever stored.
  const projects = await db
    .select({
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      ...projectLogStatsColumns(),
    })
    .from(project)
    .where(and(eq(project.ownerId, user.id), isActiveProject))
    .orderBy(desc(project.createdAt));

  const projectsWithCounts = projects.map((p) => ({
    id: p.id,
    name: p.name,
    logCount: p.logCount,
    logCountCapped: isCappedLogCount(p.logCount),
    lastActivity: p.lastActivity?.toISOString() ?? null,
    createdAt: p.createdAt?.toISOString(),
    updatedAt: p.updatedAt?.toISOString(),
  }));

  return Response.json({ projects: projectsWithCounts });
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
    .where(and(eq(project.name, name), eq(project.ownerId, user.id), isActiveProject));

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

  let created: Project | undefined;

  try {
    [created] = await db.insert(project).values(newProject).returning();
  } catch (error) {
    if (isUniqueViolation(error, "uq_project_name_owner")) {
      return apiError(400, "duplicate_name", "A project with this name already exists");
    }

    throw error;
  }

  if (!created) return apiError(500, "internal_error", "Failed to create project");

  return Response.json(
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
