import { json, type RequestHandler } from '@sveltejs/kit';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { nanoid } from 'nanoid';
import type * as schema from '$lib/server/db/schema';
import { log } from '$lib/server/db/schema';
import { logEventBus } from '$lib/server/events';
import { ApiKeyError, validateApiKey } from '$lib/server/utils/api-key';
import {
  assignIncidentIds,
  prepareLogsForIncidents,
  upsertIncidentsForPreparedLogs,
} from '$lib/server/utils/incidents';
import { parseSimpleIngestRequest, SimpleIngestError } from '$lib/server/utils/simple-ingest';

async function getDbClient(
  locals: App.Locals,
): Promise<PgliteDatabase<typeof schema> | PostgresJsDatabase<typeof schema>> {
  if (locals.db) {
    return locals.db;
  }
  const { db } = await import('$lib/server/db');
  return db;
}

/**
 * POST /v1/ingest (Simple JSON API)
 *
 * Accepts logs in a simple JSON format for easy integration.
 * Uses project API key authentication (Authorization: Bearer lw_xxx).
 *
 * Single log:
 * { "level": "info", "message": "Hello", "service": "my-app", "metadata": {...} }
 *
 * Batch:
 * [{ "level": "info", "message": "Log 1" }, { "level": "error", "message": "Log 2" }]
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  const db = await getDbClient(locals);

  // Validate API key
  let projectId: string;
  try {
    projectId = await validateApiKey(request, db);
  } catch (err) {
    if (err instanceof ApiKeyError) {
      return json({ error: 'unauthorized', message: err.message }, { status: err.status });
    }
    throw err;
  }

  // Parse JSON body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(
      { error: 'invalid_json', message: 'Request body must be valid JSON' },
      { status: 400 },
    );
  }

  // Parse and validate logs
  let result: ReturnType<typeof parseSimpleIngestRequest>;
  try {
    result = parseSimpleIngestRequest(body);
  } catch (err) {
    if (err instanceof SimpleIngestError) {
      return json({ error: 'validation_error', message: err.message }, { status: 400 });
    }
    throw err;
  }

  const { records, accepted, rejected, errors } = result;

  const preparedLogs = prepareLogsForIncidents(
    records.map((record) => ({
      level: record.level,
      message: record.message,
      timestamp: record.timestamp,
      sourceFile: record.sourceFile,
      lineNumber: record.lineNumber,
      resourceAttributes: record.resourceAttributes,
      metadata: record.metadata,
    })),
  );

  const { insertedLogs, touchedIncidents } =
    preparedLogs.length > 0
      ? await (
          db as {
            transaction: <T>(fn: (tx: typeof db) => Promise<T>) => Promise<T>;
          }
        ).transaction(async (tx) => {
          const { incidentByFingerprint, touchedIncidents } = await upsertIncidentsForPreparedLogs(
            tx,
            projectId,
            preparedLogs,
          );
          const assigned = assignIncidentIds(preparedLogs, incidentByFingerprint);

          const logEntries = assigned.map((prepared, index) => {
            const record = records[index];
            return {
              id: nanoid(),
              projectId,
              incidentId: prepared.incidentId,
              fingerprint: prepared.fingerprint,
              serviceName: prepared.serviceName,
              level: record.level,
              message: record.message,
              timestamp: record.timestamp,
              metadata: record.metadata,
              resourceAttributes: record.resourceAttributes,
              // OTLP-specific fields are null for simple API
              timeUnixNano: null,
              observedTimeUnixNano: null,
              severityNumber: null,
              severityText: null,
              body: null,
              droppedAttributesCount: null,
              flags: null,
              traceId: null,
              spanId: null,
              resourceDroppedAttributesCount: null,
              resourceSchemaUrl: null,
              scopeName: null,
              scopeVersion: null,
              scopeAttributes: null,
              scopeDroppedAttributesCount: null,
              scopeSchemaUrl: null,
              sourceFile: record.sourceFile,
              lineNumber: record.lineNumber,
              requestId: null,
              userId: null,
              ipAddress: null,
            };
          });

          const insertedLogs = await tx.insert(log).values(logEntries).returning();
          return { insertedLogs, touchedIncidents };
        })
      : { insertedLogs: [], touchedIncidents: [] };

  // Emit to event bus for real-time streaming
  for (const insertedLog of insertedLogs) {
    logEventBus.emitLog(insertedLog);
  }
  for (const touchedIncident of touchedIncidents) {
    logEventBus.emitIncident(touchedIncident);
  }

  // Build response
  const response: { accepted: number; rejected?: number; errors?: string[] } = { accepted };
  if (rejected > 0) {
    response.rejected = rejected;
    response.errors = errors;
  }

  return json(response, { status: 200 });
};
