import { z } from "zod";
import {
  jsonObjectSchema,
  jsonValueSchema,
  type JsonObject,
  type JsonValue,
} from "../../shared/schemas/json";
import { LOG_LEVELS, logLevelSchema, type LogLevel } from "../../shared/schemas/log";
import { API_CONFIG } from "../config/performance";
import type { ParsedIngest } from "./ingest";
import { BatchTooLargeError, mapOtlpAttributesToLogColumns } from "./otlp";

export interface SimpleLogInput {
  level: string;
  message: string;
  timestamp?: string;
  service?: string;
  metadata?: JsonObject;
  sourceFile?: string;
  lineNumber?: number;
}

export interface NormalizedSimpleLog {
  level: LogLevel;
  message: string;
  timestamp: Date;
  resourceAttributes: { "service.name": string } | null;
  metadata: JsonObject | null;
  sourceFile: string | null;
  lineNumber: number | null;
  requestId: string | null;
  userId: string | null;
  ipAddress: string | null;
}

export interface SimpleIngestResult {
  records: NormalizedSimpleLog[];
  accepted: number;
  rejected: number;
  errors: string[];
}

export class SimpleIngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimpleIngestError";
  }
}

// The array arm keeps a JSON-array batch element on the required-field path:
// it decodes, then fails the `level` check below instead of the object decode.
const entrySchema = z.union([jsonObjectSchema, z.array(jsonValueSchema)]);

const stringSchema = z.string();

const lineNumberSchema = z.number().int().min(1).max(2147483647);

function isValidLevel(level: unknown): level is LogLevel {
  return logLevelSchema.safeParse(level).success;
}

function optionalString(value: JsonValue | undefined): string | null {
  const decoded = stringSchema.safeParse(value);

  return decoded.success ? decoded.data : null;
}

function parseTimestamp(timestamp: JsonValue | undefined): Date {
  const value = optionalString(timestamp);

  if (value === null) {
    return new Date();
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }

  return parsed;
}

function validateLogEntry(
  input: JsonValue,
  index: number,
): { log: NormalizedSimpleLog; error: null } | { log: null; error: string } {
  const decoded = entrySchema.safeParse(input);

  if (!decoded.success) {
    return { log: null, error: `Entry at index ${index}: must be an object` };
  }

  const entry = decoded.data;

  if (!("level" in entry)) {
    return { log: null, error: `Entry at index ${index}: missing required field 'level'` };
  }

  const level = entry.level;

  if (!isValidLevel(level)) {
    // The rejected level is raw JSON; pass it to String() untyped so every
    // value renders verbatim (primitives as themselves, containers as their
    // default stringification).
    const rejectedLevel: unknown = level;

    return {
      log: null,
      error: `Entry at index ${index}: invalid level '${String(rejectedLevel)}' (must be one of: ${LOG_LEVELS.join(", ")})`,
    };
  }

  if (!("message" in entry)) {
    return { log: null, error: `Entry at index ${index}: missing required field 'message'` };
  }

  const decodedMessage = stringSchema.safeParse(entry.message);

  if (!decodedMessage.success) {
    return { log: null, error: `Entry at index ${index}: message must be a string` };
  }

  const message = decodedMessage.data;

  if (message.trim() === "") {
    return { log: null, error: `Entry at index ${index}: message cannot be empty` };
  }

  if (message.includes("\u0000")) {
    return {
      log: null,
      error: `Entry at index ${index}: message cannot contain NUL characters`,
    };
  }

  const timestamp = parseTimestamp(entry.timestamp);
  const service = optionalString(entry.service);

  const metadataResult = jsonObjectSchema.safeParse(entry.metadata);

  const metadata =
    metadataResult.success && Object.keys(metadataResult.data).length > 0
      ? metadataResult.data
      : null;

  const sourceFile = optionalString(entry.sourceFile);

  const lineNumberResult = lineNumberSchema.safeParse(entry.lineNumber);
  const lineNumber = lineNumberResult.success ? lineNumberResult.data : null;

  const mapped = mapOtlpAttributesToLogColumns(metadata);

  return {
    log: {
      level,
      message,
      timestamp,
      resourceAttributes: service ? { "service.name": service } : null,
      metadata,
      sourceFile,
      lineNumber,
      requestId: mapped.requestId,
      userId: mapped.userId,
      ipAddress: mapped.ipAddress,
    },
    error: null,
  };
}

export function parseSimpleIngestRequest(body: JsonValue | undefined): SimpleIngestResult {
  if (body === null || body === undefined) {
    throw new SimpleIngestError("Request body cannot be empty");
  }

  const entries = Array.isArray(body) ? body : [body];

  if (entries.length === 0) {
    throw new SimpleIngestError("Request body cannot be an empty array");
  }

  // Entries are counted whether or not they validate, so a junk-flooded body
  // fails as a batch error instead of materializing an error string per entry.
  if (entries.length > API_CONFIG.BATCH_INSERT_LIMIT) {
    throw new BatchTooLargeError(API_CONFIG.BATCH_INSERT_LIMIT);
  }

  const records: NormalizedSimpleLog[] = [];
  const errors: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const result = validateLogEntry(entries[i]!, i);

    if (result.log) {
      records.push(result.log);
    } else {
      errors.push(result.error);
    }
  }

  return {
    records,
    accepted: records.length,
    rejected: errors.length,
    errors,
  };
}

export function parseSimpleIngestBody(body: JsonValue | undefined): ParsedIngest {
  const result = parseSimpleIngestRequest(body);

  return {
    inputs: result.records.map((record) => ({
      level: record.level,
      message: record.message,
      timestamp: record.timestamp,
      metadata: record.metadata,
      resourceAttributes: record.resourceAttributes,
      sourceFile: record.sourceFile,
      lineNumber: record.lineNumber,
      requestId: record.requestId,
      userId: record.userId,
      ipAddress: record.ipAddress,
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
    })),
    accepted: result.accepted,
    rejected: result.rejected,
    errors: result.errors,
  };
}
