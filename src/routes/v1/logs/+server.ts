import { json, type RequestHandler } from '@sveltejs/kit';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { nanoid } from 'nanoid';
import type * as schema from '$lib/server/db/schema';
import { log } from '$lib/server/db/schema';
import { logEventBus } from '$lib/server/events';
import { ApiKeyError, validateApiKey } from '$lib/server/utils/api-key';
import {
  normalizeOtlpLogsRequest,
  OtlpValidationError,
  mapOtlpAttributesToLogColumns,
} from '$lib/server/utils/otlp';

async function getDbClient(
  locals: App.Locals,
): Promise<PgliteDatabase<typeof schema> | PostgresJsDatabase<typeof schema>> {
  if (locals.db) {
    return locals.db;
  }
  const { db } = await import('$lib/server/db');
  return db;
}

function buildPartialSuccess(rejected: number) {
  if (rejected <= 0) {
    return {};
  }

  return {
    partialSuccess: {
      rejectedLogRecords: rejected.toString(),
      errorMessage: `${rejected} log record(s) were rejected during ingestion.`,
    },
  };
}

/**
 * POST /v1/logs (OTLP/HTTP JSON)
 *
 * Accepts OTLP log exports via JSON Protobuf mapping.
 * Uses project API key authentication (Authorization: Bearer svl_xxx).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  const db = await getDbClient(locals);

  let projectId: string;
  try {
    projectId = await validateApiKey(request, db);
  } catch (err) {
    if (err instanceof ApiKeyError) {
      return json({ error: 'unauthorized', message: err.message }, { status: err.status });
    }
    throw err;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(
      { error: 'invalid_json', message: 'Request body must be valid JSON' },
      { status: 400 },
    );
  }

  let normalized;
  try {
    normalized = normalizeOtlpLogsRequest(body);
  } catch (err) {
    if (err instanceof OtlpValidationError) {
      return json({ error: 'validation_error', message: err.message }, { status: 400 });
    }
    throw err;
  }

  const { records, rejectedLogRecords } = normalized;

  const logEntries = records.map((record) => ({
    ...mapOtlpAttributesToLogColumns(record.attributes),
    id: nanoid(),
    projectId,
    level: record.level,
    message: record.message,
    metadata: record.attributes ?? null,
    timeUnixNano: record.timeUnixNano,
    observedTimeUnixNano: record.observedTimeUnixNano,
    severityNumber: record.severityNumber,
    severityText: record.severityText,
    body: record.body ?? null,
    droppedAttributesCount: record.droppedAttributesCount,
    flags: record.flags,
    traceId: record.traceId,
    spanId: record.spanId,
    resourceAttributes: record.resourceAttributes,
    resourceDroppedAttributesCount: record.resourceDroppedAttributesCount,
    resourceSchemaUrl: record.resourceSchemaUrl,
    scopeName: record.scopeName,
    scopeVersion: record.scopeVersion,
    scopeAttributes: record.scopeAttributes,
    scopeDroppedAttributesCount: record.scopeDroppedAttributesCount,
    scopeSchemaUrl: record.scopeSchemaUrl,
    timestamp: record.timestamp,
  }));

  const insertedLogs =
    logEntries.length > 0 ? await db.insert(log).values(logEntries).returning() : [];

  for (const insertedLog of insertedLogs) {
    logEventBus.emitLog(insertedLog);
  }

  return json(buildPartialSuccess(rejectedLogRecords), { status: 200 });
};
