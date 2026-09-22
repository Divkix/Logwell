import { json } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
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
import { BatchTooLargeError, OtlpValidationError } from "$lib/server/utils/otlp";
import { checkRateLimit, INGEST_RPM } from "$lib/server/utils/rate-limit";
import { SimpleIngestError } from "$lib/server/utils/simple-ingest";
import { jsonObjectSchema, type JsonObject, type JsonValue } from "../../shared/schemas/json";

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

// DatabaseClient is a union of two flavours, which defeats overload resolution on
// the projected `.returning(fields)` call, so the insert builder is narrowed to the
// contract both flavours declare. The projection names every log column but the
// generated `search`, which is exactly StreamLog.
type LogInsertReturning = {
  returning: (fields: typeof LOG_RETURNING_COLUMNS) => PromiseLike<StreamLog[]>;
};

// drizzle types jsonb columns as unknown, which is wider than the JSON values
// both ingest parsers actually assign, so the four jsonb columns are re-declared
// as the JSON domain they hold.
export type IngestInputRow = Omit<
  NewLog,
  | "id"
  | "projectId"
  | "incidentId"
  | "fingerprint"
  | "serviceName"
  | "search"
  | "body"
  | "metadata"
  | "resourceAttributes"
  | "scopeAttributes"
> & {
  body: JsonValue;
  metadata: JsonObject | null;
  resourceAttributes: JsonObject | null;
  scopeAttributes: JsonObject | null;
  timestamp: Date;
};

export interface ParsedIngest {
  inputs: IngestInputRow[];
  accepted: number;
  rejected: number;
  errors: string[];
}

export type IngestBodyParser = (body: JsonValue | undefined) => ParsedIngest;

// Postgres rejects U+0000 in both text and jsonb columns, so NUL characters are
// stripped from every string bound for a column. The walk is depth-bounded
// because the payload is attacker-controlled; deeper levels are dropped.
const MAX_NUL_STRIP_DEPTH = 32;

const nulStrippedString = z.string().transform((text) => text.replaceAll("\u0000", ""));

function stripNulStrings(value: JsonValue, depth = 0): JsonValue {
  const text = nulStrippedString.safeParse(value);

  if (text.success) return text.data;

  if (depth >= MAX_NUL_STRIP_DEPTH) return null;

  if (Array.isArray(value)) {
    return value.map((entry) => stripNulStrings(entry, depth + 1));
  }

  const record = jsonObjectSchema.safeParse(value);

  if (!record.success) return value;

  return Object.fromEntries(
    Object.entries(record.data).map(([key, entry]) => [
      key.replaceAll("\u0000", ""),
      stripNulStrings(entry, depth + 1),
    ]),
  );
}

function sanitizeIngestInput(input: IngestInputRow): IngestInputRow {
  // SAFETY: Object.entries keeps every own enumerable key of `input` (including
  // `message`, which is passed through untouched); only NUL bytes are stripped
  // from the other values, so the rebuilt object has IngestInputRow's exact
  // runtime shape.
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) =>
      // A NUL in `message` is a per-record rejection in both parsers, never a strip.
      // The timestamp is a Date, which is bound to its column untouched.
      key === "message" || value instanceof Date ? [key, value] : [key, stripNulStrings(value)],
    ),
  ) as IngestInputRow;
}

export function buildIngestResponse(accepted: number, rejected: number, errors: string[]) {
  if (rejected <= 0) return { accepted };

  return { accepted, rejected, errors };
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

  let body: JsonValue | undefined;

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
    if (err instanceof BatchTooLargeError) {
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

  const inputs = parsed.inputs.map(sanitizeIngestInput);

  const preparedLogs = prepareLogsForIncidents(
    inputs.map((input) => ({
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
            ...inputs[index]!,
            id: nanoid(),
            projectId,
            incidentId: prepared.incidentId,
            fingerprint: prepared.fingerprint,
            serviceName: prepared.serviceName,
          }));

          // SAFETY: DatabaseClient's union defeats overload resolution on the projected
          // `.returning()`; both flavours declare it with this signature, so the builder is
          // narrowed to the contract it already satisfies.
          const projectedInsert = tx.insert(log).values(logEntries) as LogInsertReturning;
          const insertedLogs: StreamLog[] = await projectedInsert.returning(LOG_RETURNING_COLUMNS);

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
