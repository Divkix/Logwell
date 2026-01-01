import { json, type RequestHandler } from '@sveltejs/kit';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { nanoid } from 'nanoid';
import type * as schema from '$lib/server/db/schema';
import { log } from '$lib/server/db/schema';
import { ApiKeyError, validateApiKey } from '$lib/server/utils/api-key';
import { logPayloadSchema } from '$lib/shared/schemas/log';

/**
 * Gets the database client, preferring injected test db over production db
 */
async function getDbClient(
  locals: App.Locals,
): Promise<PgliteDatabase<typeof schema> | PostgresJsDatabase<typeof schema>> {
  // Use injected db for testing, otherwise lazy-load production db
  if (locals.db) {
    return locals.db;
  }
  const { db } = await import('$lib/server/db');
  return db;
}

/**
 * POST /api/v1/logs
 *
 * Ingest a single log entry.
 *
 * Headers:
 *   Authorization: Bearer svl_xxxxx
 *   Content-Type: application/json
 *
 * Request Body:
 *   {
 *     "level": "error",
 *     "message": "Database connection failed",
 *     "metadata": { ... },           // optional
 *     "source_file": "src/db.ts",    // optional
 *     "line_number": 45,             // optional
 *     "request_id": "req_abc123",    // optional
 *     "user_id": "user_456",         // optional
 *     "ip_address": "192.168.1.100"  // optional
 *   }
 *
 * Response (201 Created):
 *   { "id": "log_xyz", "timestamp": "2024-01-15T14:32:05.123Z" }
 *
 * Errors:
 *   401: Invalid or missing API key
 *   400: Validation error (invalid level, missing message, etc.)
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  // Get database client
  const db = await getDbClient(locals);

  // Validate API key and get project ID
  let projectId: string;
  try {
    projectId = await validateApiKey(request, db);
  } catch (err) {
    if (err instanceof ApiKeyError) {
      return json({ error: 'unauthorized', message: err.message }, { status: err.status });
    }
    throw err;
  }

  // Parse request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(
      { error: 'invalid_json', message: 'Request body must be valid JSON' },
      { status: 400 },
    );
  }

  // Validate payload using Zod schema
  const parsed = logPayloadSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues ?? [];
    const firstError = issues[0];
    const field = firstError?.path.join('.') || 'unknown';
    const message = firstError?.message || 'Validation failed';

    return json(
      {
        error: 'validation_error',
        message: `${field}: ${message}`,
      },
      { status: 400 },
    );
  }

  const data = parsed.data;

  // Generate log ID and timestamp
  const logId = nanoid();
  const timestamp = data.timestamp ?? new Date();

  // Insert log into database
  const [inserted] = await db
    .insert(log)
    .values({
      id: logId,
      projectId,
      level: data.level,
      message: data.message,
      metadata: data.metadata ?? null,
      sourceFile: data.sourceFile ?? null,
      lineNumber: data.lineNumber ?? null,
      requestId: data.requestId ?? null,
      userId: data.userId ?? null,
      ipAddress: data.ipAddress ?? null,
      timestamp,
    })
    .returning();

  // Return success response
  return json(
    {
      id: inserted.id,
      timestamp: inserted.timestamp?.toISOString(),
    },
    { status: 201 },
  );
};
