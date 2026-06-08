import { json, type RequestHandler } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { API_CONFIG } from "$lib/server/config/performance";
import { getDbClient } from "$lib/server/db/db";
import { log, project } from "$lib/server/db/schema";
import { logEventBus } from "$lib/server/events";
import { ApiKeyError, validateApiKey } from "$lib/server/utils/api-key";
import { requireJsonContentType } from "$lib/server/utils/content-type";
import {
  assignIncidentIds,
  prepareLogsForIncidents,
  upsertIncidentsForPreparedLogs,
} from "$lib/server/utils/incidents";
import {
  mapOtlpAttributesToLogColumns,
  type NormalizedOtlpLogsResult,
  normalizeOtlpLogsRequest,
  OtlpValidationError,
} from "$lib/server/utils/otlp";
import { checkRateLimit, INGEST_RPM } from "$lib/server/utils/rate-limit";

function buildIngestResponse(accepted: number, rejected: number, errors: string[]) {
  const response: { accepted: number; rejected?: number; errors?: string[] } = { accepted };
  if (rejected > 0) {
    response.rejected = rejected;
    response.errors = errors;
  }
  return response;
}

/**
 * POST /v1/logs (OTLP/HTTP JSON)
 *
 * Accepts OTLP log exports via JSON Protobuf mapping.
 * Uses project API key authentication (Authorization: Bearer lw_xxx).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  // Validate Content-Type
  const contentTypeError = requireJsonContentType(request);
  if (contentTypeError) return contentTypeError;

  const db = await getDbClient(locals);

  let projectId: string;
  try {
    projectId = await validateApiKey(request, db);

    // Re-verify project exists to prevent stale cache (multi-process) from causing FK violations.
    // This intentionally adds one DB read per ingest request for correctness across processes.
    const [projectRow] = await db
      .select({ id: project.id })
      .from(project)
      .where(eq(project.id, projectId));
    if (!projectRow) {
      throw new ApiKeyError(401, "Invalid API key");
    }
  } catch (err) {
    if (err instanceof ApiKeyError) {
      return json({ error: "unauthorized", message: err.message }, { status: err.status });
    }
    throw err;
  }

  // Apply rate limiting per project
  if (!checkRateLimit(`ingest:${projectId}`, INGEST_RPM)) {
    return new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": "60" },
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(
      { error: "invalid_json", message: "Request body must be valid JSON" },
      { status: 400 },
    );
  }

  // Batch size is enforced accurately against the real log-record count after
  // normalization below (resourceLogs.length is the resource count, not the
  // record count, so an early heuristic could reject valid payloads).
  let normalized: NormalizedOtlpLogsResult;
  try {
    normalized = normalizeOtlpLogsRequest(body);
  } catch (err) {
    if (err instanceof OtlpValidationError) {
      return json({ error: "validation_error", message: err.message }, { status: 400 });
    }
    throw err;
  }

  const { records, rejectedLogRecords, errors } = normalized;

  if (records.length > API_CONFIG.BATCH_INSERT_LIMIT) {
    return json(
      {
        error: "batch_too_large",
        message: `Batch exceeds maximum limit of ${API_CONFIG.BATCH_INSERT_LIMIT} logs. Received ${records.length} logs.`,
      },
      { status: 400 },
    );
  }

  const preparedLogs = prepareLogsForIncidents(
    records.map((record) => {
      const mapped = mapOtlpAttributesToLogColumns(record.attributes);
      return {
        level: record.level,
        message: record.message,
        timestamp: record.timestamp,
        sourceFile: mapped.sourceFile,
        lineNumber: mapped.lineNumber,
        resourceAttributes: record.resourceAttributes,
        metadata: record.attributes ?? null,
      };
    }),
  );

  const { insertedLogs, touchedIncidents } =
    preparedLogs.length > 0
      ? await db.transaction(async (tx) => {
          const { incidentByFingerprint, touchedIncidents } = await upsertIncidentsForPreparedLogs(
            tx,
            projectId,
            preparedLogs,
          );
          const assigned = assignIncidentIds(preparedLogs, incidentByFingerprint);

          const logEntries = assigned.map((prepared, index) => {
            const record = records[index]!;
            const mapped = mapOtlpAttributesToLogColumns(record.attributes);

            return {
              ...mapped,
              id: nanoid(),
              projectId,
              incidentId: prepared.incidentId,
              fingerprint: prepared.fingerprint,
              serviceName: prepared.serviceName,
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
            };
          });

          const insertedLogs = await tx.insert(log).values(logEntries).returning();
          return { insertedLogs, touchedIncidents };
        })
      : { insertedLogs: [], touchedIncidents: [] };

  for (const insertedLog of insertedLogs) {
    logEventBus.emitLog(insertedLog);
  }
  for (const touchedIncident of touchedIncidents) {
    logEventBus.emitIncident(touchedIncident);
  }

  return json(buildIngestResponse(records.length, rejectedLogRecords, errors), { status: 200 });
};
