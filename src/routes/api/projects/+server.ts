import { json } from "@sveltejs/kit";
import { and, count, desc, eq } from "drizzle-orm";
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
  // Require session authentication
  const { user } = await requireAuth(event);

  const db = await getDbClient(event.locals);

  // Query projects owned by the authenticated user
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

  // Get log counts for each project
  const projectsWithCounts = await Promise.all(
    projects.map(async (p) => {
      const [logCountResult] = await db
        .select({ count: count() })
        .from(log)
        .where(eq(log.projectId, p.id));

      return {
        id: p.id,
        name: p.name,
        logCount: logCountResult?.count ?? 0,
        createdAt: p.createdAt?.toISOString(),
        updatedAt: p.updatedAt?.toISOString(),
      };
    }),
  );

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
  // CSRF protection for state-changing request
  const csrfError = checkCsrfOrigin(event);
  if (csrfError) return csrfError;

  // Validate Content-Type
  const contentTypeError = requireJsonContentType(event.request);
  if (contentTypeError) return contentTypeError;

  // Require session authentication
  const { user } = await requireAuth(event);

  const db = await getDbClient(event.locals);

  // Parse request body
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return apiError(400, "invalid_json", "Invalid JSON body");
  }

  // Validate request body
  const validation = projectCreatePayloadSchema.safeParse(body);
  if (!validation.success) {
    const issues = validation.error.issues ?? [];
    const firstError = issues[0];
    const field = firstError?.path.join(".") || "name";
    const message = firstError?.message || "Validation failed";

    return apiError(400, "validation_error", `${field}: ${message}`);
  }

  const { name } = validation.data;

  // Check for duplicate name scoped to the current user
  const [existing] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.name, name), eq(project.ownerId, user.id)));

  if (existing) {
    return apiError(400, "duplicate_name", "A project with this name already exists");
  }

  // Generate new project with current user as owner. The plaintext key is
  // returned once below and never persisted — only its hash is stored.
  const generatedApiKey = generateApiKey();
  const newProject = {
    id: nanoid(),
    name,
    apiKeyHash: hashApiKey(generatedApiKey),
    ownerId: user.id,
  };

  // Insert project
  const [created] = await db.insert(project).values(newProject).returning();
  if (!created) return apiError(500, "internal_error", "Failed to create project");

  return json(
    {
      id: created.id,
      name: created.name,
      // Shown only once; the plaintext key is not stored and cannot be retrieved later.
      apiKey: generatedApiKey,
      createdAt: created.createdAt?.toISOString(),
      updatedAt: created.updatedAt?.toISOString(),
    },
    { status: 201 },
  );
}
