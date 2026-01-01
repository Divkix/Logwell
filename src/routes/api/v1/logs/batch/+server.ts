import { json, type RequestHandler } from '@sveltejs/kit';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { nanoid } from 'nanoid';
import type * as schema from '$lib/server/db/schema';
import { log } from '$lib/server/db/schema';
import { logEventBus } from '$lib/server/events';
import { ApiKeyError, validateApiKey } from '$lib/server/utils/api-key';
import { batchLogPayloadSchema } from '$lib/shared/schemas/log';

async function getDbClient(
  locals: App.Locals,
): Promise<PgliteDatabase<typeof schema> | PostgresJsDatabase<typeof schema>> {
  if (locals.db) {
    return locals.db;
  }
  const { db } = await import('$lib/server/db');
  return db;
}

export const POST: RequestHandler = async ({ request, locals }) => {
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

  // Parse JSON
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(
      { error: 'invalid_json', message: 'Request body must be valid JSON' },
      { status: 400 },
    );
  }

  // Validate batch payload
  const parsed = batchLogPayloadSchema.safeParse(body);
  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    const field = firstError?.path.join('.') || 'logs';
    const message = firstError?.message || 'Validation failed';

    return json({ error: 'validation_error', message: `${field}: ${message}` }, { status: 400 });
  }

  const { logs: logPayloads } = parsed.data;

  // Build log entries with generated IDs
  const now = new Date();
  const logEntries = logPayloads.map((data) => ({
    id: nanoid(),
    projectId,
    level: data.level,
    message: data.message,
    metadata: data.metadata ?? null,
    sourceFile: data.sourceFile ?? null,
    lineNumber: data.lineNumber ?? null,
    requestId: data.requestId ?? null,
    userId: data.userId ?? null,
    ipAddress: data.ipAddress ?? null,
    timestamp: data.timestamp ?? now,
  }));

  // Insert all logs
  const insertedLogs = await db.insert(log).values(logEntries).returning();

  // Emit all logs to event bus for real-time streaming
  for (const insertedLog of insertedLogs) {
    logEventBus.emitLog(insertedLog);
  }

  return json(
    {
      inserted: insertedLogs.length,
      logs: insertedLogs.map((l) => ({
        id: l.id,
        timestamp: l.timestamp?.toISOString(),
      })),
    },
    { status: 201 },
  );
};
