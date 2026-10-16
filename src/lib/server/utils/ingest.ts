import { and, eq } from "drizzle-orm";
import { Data, Effect } from "effect";
import { nanoid } from "nanoid";
import { z } from "zod";
import { API_CONFIG } from "#lib/server/config/performance.js";
import type { DatabaseClient } from "#lib/server/db/db.js";
import { isActiveProject } from "#lib/server/db/predicates.js";
import { log, type NewLog, project } from "#lib/server/db/schema.js";
import { logEventBus, type StreamLog } from "#lib/server/events.js";
import { ApiKeyError, validateApiKey } from "#lib/server/utils/api-key.js";
import { requireJsonContentType } from "#lib/server/utils/content-type.js";
import {
  assignIncidentIds,
  prepareLogsForIncidents,
  upsertIncidentsForPreparedLogs,
} from "#lib/server/utils/incidents.js";
import { BatchTooLargeError, OtlpValidationError } from "#lib/server/utils/otlp.js";
import { checkRateLimit, INGEST_RPM } from "#lib/server/utils/rate-limit.js";
import { SimpleIngestError } from "#lib/server/utils/simple-ingest.js";
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

// Batch-level failures, each mapped to exactly one response in `ingestLogs`.
class Unauthorized extends Data.TaggedError("Unauthorized")<{
  readonly status: number;
  readonly message: string;
}> {}

class RateLimited extends Data.TaggedError("RateLimited") {}

class InvalidJson extends Data.TaggedError("InvalidJson") {}

class PayloadTooLarge extends Data.TaggedError("PayloadTooLarge") {}

// adapter-node enforces BODY_SIZE_LIMIT by erroring the request body stream with a SvelteKitError
// carrying status 413, so it surfaces here from request.json() rather than before the handler.
const payloadTooLargeSchema = z.object({ status: z.literal(413) });

class BatchTooLarge extends Data.TaggedError("BatchTooLarge")<{ readonly message: string }> {}

class ValidationFailed extends Data.TaggedError("ValidationFailed")<{ readonly message: string }> {}

async function insertBatch(db: DatabaseClient, projectId: string, inputs: IngestInputRow[]) {
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

  if (preparedLogs.length === 0) return { insertedLogs: [], touchedIncidents: [] };

  return db.transaction(async (tx) => {
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
  });
}

function ingest(request: Request, db: DatabaseClient, parse: IngestBodyParser) {
  return Effect.gen(function* () {
    // Both `catch` mappers below (key validation, parse) re-throw what they don't recognise:
    // a throwing mapper makes the error a defect, which `Effect.runPromise` rejects with
    // unchanged, so unexpected errors reach SvelteKit's handleError exactly as thrown.
    const { projectId, keyHash } = yield* Effect.tryPromise({
      try: () => validateApiKey(request, db),
      catch: (err) => {
        if (err instanceof ApiKeyError) {
          return new Unauthorized({ status: err.status, message: err.message });
        }

        throw err;
      },
    });

    // Two re-checks against the row: the presented hash (the key cache can lag a rotation on
    // another replica, or a lookup racing the UPDATE, so a rotated key stops ingesting as soon as
    // the rotation commits) and isActiveProject (a key validated from the cache just before its
    // project was soft-deleted still resolves to the project id).
    const [projectRow] = yield* Effect.promise(() =>
      db
        .select({ id: project.id })
        .from(project)
        .where(and(eq(project.id, projectId), eq(project.apiKeyHash, keyHash), isActiveProject)),
    );

    if (!projectRow) return yield* new Unauthorized({ status: 401, message: "Invalid API key" });

    if (!checkRateLimit(`ingest:${projectId}`, INGEST_RPM)) return yield* new RateLimited();

    const body = yield* Effect.tryPromise({
      try: (): Promise<JsonValue | undefined> => request.json(),
      catch: (err) =>
        payloadTooLargeSchema.safeParse(err).success ? new PayloadTooLarge() : new InvalidJson(),
    });

    const parsed = yield* Effect.try({
      try: () => parse(body),
      catch: (err) => {
        // BatchTooLargeError extends OtlpValidationError, so it is matched first.
        if (err instanceof BatchTooLargeError) return new BatchTooLarge({ message: err.message });

        if (err instanceof OtlpValidationError || err instanceof SimpleIngestError) {
          return new ValidationFailed({ message: err.message });
        }

        throw err;
      },
    });

    if (parsed.inputs.length > API_CONFIG.BATCH_INSERT_LIMIT) {
      return yield* new BatchTooLarge({
        message: `Batch exceeds maximum limit of ${API_CONFIG.BATCH_INSERT_LIMIT} logs. Received ${parsed.inputs.length} logs.`,
      });
    }

    const inputs = parsed.inputs.map(sanitizeIngestInput);

    const { insertedLogs, touchedIncidents } = yield* Effect.promise(() =>
      insertBatch(db, projectId, inputs),
    );

    for (const insertedLog of insertedLogs) {
      logEventBus.emitLog(insertedLog);
    }

    for (const touchedIncident of touchedIncidents) {
      logEventBus.emitIncident(touchedIncident);
    }

    return Response.json(buildIngestResponse(parsed.accepted, parsed.rejected, parsed.errors));
  });
}

const errorResponse = (error: string, message: string, init: ResponseInit = { status: 400 }) =>
  Effect.succeed(Response.json({ error, message }, init));

export async function ingestLogs(
  request: Request,
  db: DatabaseClient,
  parse: IngestBodyParser,
): Promise<Response> {
  const unsupported = requireJsonContentType(request);

  if (unsupported) return unsupported;

  // Annotated with no error channel, so a failure without a case here fails to compile.
  const program: Effect.Effect<Response> = ingest(request, db, parse).pipe(
    Effect.catchTags({
      Unauthorized: ({ status, message }) => errorResponse("unauthorized", message, { status }),
      RateLimited: () =>
        errorResponse("rate_limited", "Rate limit exceeded. Retry in 60 seconds.", {
          status: 429,
          headers: { "Retry-After": "60" },
        }),
      InvalidJson: () => errorResponse("invalid_json", "Request body must be valid JSON"),
      PayloadTooLarge: () =>
        errorResponse("payload_too_large", "Request body exceeds BODY_SIZE_LIMIT", {
          status: 413,
        }),
      BatchTooLarge: ({ message }) => errorResponse("batch_too_large", message),
      ValidationFailed: ({ message }) => errorResponse("validation_error", message),
    }),
  );

  return Effect.runPromise(program);
}
