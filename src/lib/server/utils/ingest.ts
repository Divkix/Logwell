import { log } from "$lib/server/db/schema";

/**
 * Column map shared by both ingest endpoints' insert `.returning(...)` calls.
 *
 * It lists every `log` column **except** the generated `search` tsvector, which
 * must never be fetched into the SSE payload. Keeping a single definition means
 * `/v1/logs` and `/v1/ingest` can never silently drift to emit different shapes.
 */
export const LOG_RETURNING_COLUMNS = {
  id: log.id,
  projectId: log.projectId,
  incidentId: log.incidentId,
  fingerprint: log.fingerprint,
  serviceName: log.serviceName,
  level: log.level,
  message: log.message,
  metadata: log.metadata,
  timeUnixNano: log.timeUnixNano,
  observedTimeUnixNano: log.observedTimeUnixNano,
  severityNumber: log.severityNumber,
  severityText: log.severityText,
  body: log.body,
  droppedAttributesCount: log.droppedAttributesCount,
  flags: log.flags,
  traceId: log.traceId,
  spanId: log.spanId,
  resourceAttributes: log.resourceAttributes,
  resourceDroppedAttributesCount: log.resourceDroppedAttributesCount,
  resourceSchemaUrl: log.resourceSchemaUrl,
  scopeName: log.scopeName,
  scopeVersion: log.scopeVersion,
  scopeAttributes: log.scopeAttributes,
  scopeDroppedAttributesCount: log.scopeDroppedAttributesCount,
  scopeSchemaUrl: log.scopeSchemaUrl,
  sourceFile: log.sourceFile,
  lineNumber: log.lineNumber,
  requestId: log.requestId,
  userId: log.userId,
  ipAddress: log.ipAddress,
  timestamp: log.timestamp,
} as const;

/**
 * Builds the JSON body shared by both ingest endpoints. `rejected`/`errors` are
 * only included when at least one record was rejected.
 */
export function buildIngestResponse(accepted: number, rejected: number, errors: string[]) {
  const response: { accepted: number; rejected?: number; errors?: string[] } = { accepted };
  if (rejected > 0) {
    response.rejected = rejected;
    response.errors = errors;
  }
  return response;
}
