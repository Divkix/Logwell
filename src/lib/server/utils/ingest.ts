import { json } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { API_CONFIG } from "$lib/server/config/performance";
import type { DatabaseClient } from "$lib/server/db/db";
import { log, type NewLog, project } from "$lib/server/db/schema";
import { logEventBus, type StreamLog } from "$lib/server/events";
import { ApiKeyError, validateApiKey } from "$lib/server/utils/api-key";
import { requireJsonContentType } from "$lib/server/utils/content-type";
import {
  assignIncidentIds,
  prepareLogsForIncidents,
  upsertIncidentsForPreparedLogs,
} from "$lib/server/utils/incidents";
import { OtlpBatchTooLargeError, OtlpValidationError } from "$lib/server/utils/otlp";
import { checkRateLimit, INGEST_RPM } from "$lib/server/utils/rate-limit";
import { SimpleIngestError } from "$lib/server/utils/simple-ingest";

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

export type IngestInputRow = Omit<
  NewLog,
  "id" | "projectId" | "incidentId" | "fingerprint" | "serviceName" | "search"
> & {
  timestamp: Date;
};

export interface ParsedIngest {
  inputs: IngestInputRow[];
  accepted: number;
  rejected: number;
  errors: string[];
}

export type IngestBodyParser = (body: unknown) => ParsedIngest;

export function buildIngestResponse(accepted: number, rejected: number, errors: string[]) {
  const response: { accepted: number; rejected?: number; errors?: string[] } = { accepted };
  if (rejected > 0) {
    response.rejected = rejected;
    response.errors = errors;
  }
  return response;
}

export async function ingestLogs(
  request: Request,
  db: DatabaseClient,
  parse: IngestBodyParser,
): Promise<Response> {
  const contentTypeError = requireJsonContentType(request);
  if (contentTypeError) return contentTypeError;

  let projectId: string;
  try {
    projectId = await validateApiKey(request, db);

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

  if (!checkRateLimit(`ingest:${projectId}`, INGEST_RPM)) {
    return json(
      { error: "rate_limited", message: "Rate limit exceeded. Retry in 60 seconds." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
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

  let parsed: ParsedIngest;
  try {
    parsed = parse(body);
  } catch (err) {
    if (err instanceof OtlpBatchTooLargeError) {
      return json({ error: "batch_too_large", message: err.message }, { status: 400 });
    }
    if (err instanceof OtlpValidationError || err instanceof SimpleIngestError) {
      return json({ error: "validation_error", message: err.message }, { status: 400 });
    }
    throw err;
  }

  if (parsed.inputs.length > API_CONFIG.BATCH_INSERT_LIMIT) {
    return json(
      {
        error: "batch_too_large",
        message: `Batch exceeds maximum limit of ${API_CONFIG.BATCH_INSERT_LIMIT} logs. Received ${parsed.inputs.length} logs.`,
      },
      { status: 400 },
    );
  }

  const preparedLogs = prepareLogsForIncidents(
    parsed.inputs.map((input) => ({
      level: input.level,
      message: input.message,
      timestamp: input.timestamp,
      sourceFile: input.sourceFile ?? null,
      lineNumber: input.lineNumber ?? null,
      resourceAttributes: input.resourceAttributes ?? null,
      metadata: input.metadata ?? null,
    })),
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

          const logEntries = assigned.map((prepared, index) => ({
            ...parsed.inputs[index]!,
            id: nanoid(),
            projectId,
            incidentId: prepared.incidentId,
            fingerprint: prepared.fingerprint,
            serviceName: prepared.serviceName,
          }));

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const insertedLogs: StreamLog[] = await (
            tx.insert(log).values(logEntries) as any
          ).returning(LOG_RETURNING_COLUMNS);
          return { insertedLogs, touchedIncidents };
        })
      : { insertedLogs: [], touchedIncidents: [] };

  for (const insertedLog of insertedLogs) {
    logEventBus.emitLog(insertedLog);
  }
  for (const touchedIncident of touchedIncidents) {
    logEventBus.emitIncident(touchedIncident);
  }

  return json(buildIngestResponse(parsed.accepted, parsed.rejected, parsed.errors), {
    status: 200,
  });
}
