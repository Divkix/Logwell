import { z } from "zod";
import type { LogLevel } from "$lib/shared/types";
import { jsonObjectSchema, type JsonObject, type JsonValue } from "../../shared/schemas/json";
import { API_CONFIG } from "../config/performance";
import type { ParsedIngest } from "./ingest";

export class OtlpValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OtlpValidationError";
  }
}

// Shared by both ingest adapters: the batch cap counts every entry in the body
// (accepted and rejected alike), so the simple parser throws it too.
export class BatchTooLargeError extends OtlpValidationError {
  constructor(limit: number) {
    super(`Batch exceeds maximum limit of ${limit} logs.`);
    this.name = "BatchTooLargeError";
  }
}

export type NormalizedOtlpLogRecord = {
  timeUnixNano: string | null;
  observedTimeUnixNano: string | null;
  severityNumber: number | null;
  severityText: string | null;
  body: JsonValue;
  attributes: JsonObject | null;
  droppedAttributesCount: number | null;
  flags: number | null;
  traceId: string | null;
  spanId: string | null;
  resourceAttributes: JsonObject | null;
  resourceDroppedAttributesCount: number | null;
  resourceSchemaUrl: string | null;
  scopeName: string | null;
  scopeVersion: string | null;
  scopeAttributes: JsonObject | null;
  scopeDroppedAttributesCount: number | null;
  scopeSchemaUrl: string | null;
  message: string;
  level: LogLevel;
  timestamp: Date;
};

export type NormalizedOtlpLogsResult = {
  records: NormalizedOtlpLogRecord[];
  rejectedLogRecords: number;
  errors: string[];
};

const TRACE_ID_REGEX = /^[0-9a-f]{32}$/i;

const SPAN_ID_REGEX = /^[0-9a-f]{16}$/i;

// Wire values are decoded JSON: parse once with the project's JSON-object
// schema, then consume the named output instead of re-guarding ad hoc.
function decodeObject(value: JsonValue | undefined): JsonObject | null {
  const decoded = jsonObjectSchema.safeParse(value);

  return decoded.success ? decoded.data : null;
}

function decodeString(value: JsonValue | undefined): string | null {
  const decoded = z.string().safeParse(value);

  return decoded.success ? decoded.data : null;
}

function clampInt32(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const t = Math.trunc(value);

  if (t < -2147483648 || t > 2147483647) return null;

  return t;
}

export function parseUint64String(value: JsonValue | undefined): string | null {
  const asString = decodeString(value);

  if (asString !== null) {
    const trimmed = asString.trim();

    if (!trimmed) return null;

    if (!/^\d+$/.test(trimmed)) return null;

    return trimmed;
  }

  const asNumber = z.number().safeParse(value);

  if (asNumber.success && Number.isInteger(asNumber.data) && asNumber.data >= 0) {
    return Math.trunc(asNumber.data).toString();
  }

  return null;
}

function parseOptionalNumber(value: JsonValue | undefined): number | null {
  const asNumber = z.number().safeParse(value);

  if (asNumber.success) {
    return clampInt32(asNumber.data);
  }

  const asString = decodeString(value);

  if (asString !== null && asString.trim()) {
    const parsed = Number(asString);

    return Number.isFinite(parsed) ? clampInt32(parsed) : null;
  }

  return null;
}

function parseIntValue(value: JsonValue | undefined): number | string | null {
  const asNumber = z.number().safeParse(value);

  if (asNumber.success) {
    return Number.isSafeInteger(asNumber.data) ? asNumber.data : Math.trunc(asNumber.data);
  }

  const asString = decodeString(value);

  if (asString !== null) {
    const trimmed = asString.trim();

    if (!/^-?\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);

    if (Number.isSafeInteger(parsed)) {
      return parsed;
    }

    return trimmed;
  }

  return null;
}

function nonZeroNano(value: string | null): string | null {
  if (value === null) return null;

  return /^0+$/.test(value) ? null : value;
}

function parseTimestamp(timeUnixNano: string | null, observedTimeUnixNano: string | null): Date {
  const candidate = nonZeroNano(timeUnixNano) ?? nonZeroNano(observedTimeUnixNano);

  if (!candidate) {
    return new Date();
  }

  try {
    const nanos = BigInt(candidate);
    const millis = Number(nanos / 1000000n);
    const date = new Date(millis);

    if (Number.isNaN(date.getTime())) {
      return new Date();
    }

    return date;
  } catch {
    return new Date();
  }
}

function parseSeverityNumber(value: JsonValue | undefined): number | null {
  const numberValue = parseOptionalNumber(value);

  if (numberValue === null) return null;
  const rounded = clampInt32(numberValue);

  if (rounded === null) return null;

  if (rounded < 0) return null;

  return rounded;
}

function severityTextToLogLevel(value: string | null): LogLevel | null {
  if (!value) return null;
  const normalized = value.toLowerCase();

  if (normalized.includes("fatal") || normalized.includes("critical")) return "fatal";

  if (normalized.includes("error")) return "error";

  if (normalized.includes("warn")) return "warn";

  if (normalized.includes("info")) return "info";

  if (normalized.includes("debug") || normalized.includes("trace")) return "debug";

  return null;
}

export function severityNumberToLogLevel(value: number | null | undefined): LogLevel {
  if (!value || value <= 0) {
    return "info";
  }

  if (value <= 8) {
    return "debug";
  }

  if (value <= 12) {
    return "info";
  }

  if (value <= 16) {
    return "warn";
  }

  if (value <= 20) {
    return "error";
  }

  return "fatal";
}

function attributeString(attributes: JsonObject | null, keys: string[]): string | null {
  if (!attributes) return null;

  for (const key of keys) {
    const value = attributes[key];
    const decoded = decodeString(value);

    if (decoded !== null && decoded.trim()) {
      return decoded;
    }
  }

  return null;
}

function attributeInt(attributes: JsonObject | null, keys: string[]): number | null {
  if (!attributes) return null;

  for (const key of keys) {
    const value = attributes[key];
    const asNumber = z.number().safeParse(value);

    if (asNumber.success && Number.isSafeInteger(asNumber.data)) {
      return asNumber.data > 0 ? clampInt32(asNumber.data) : null;
    }

    const decoded = decodeString(value);

    if (decoded !== null && decoded.trim()) {
      const parsed = Number.parseInt(decoded, 10);

      if (Number.isSafeInteger(parsed)) {
        return parsed > 0 ? clampInt32(parsed) : null;
      }
    }
  }

  return null;
}

export function mapOtlpAttributesToLogColumns(attributes: JsonObject | null) {
  const sourceFile = attributeString(attributes, ["code.filepath", "source.file", "source_file"]);
  const lineNumber = attributeInt(attributes, ["code.lineno", "source.line", "line_number"]);
  const requestId = attributeString(attributes, ["request.id", "request_id", "http.request_id"]);
  const userId = attributeString(attributes, ["enduser.id", "user.id", "user_id"]);

  const ipAddress = attributeString(attributes, [
    "client.address",
    "ip",
    "ip_address",
    "net.peer.ip",
    "net.sock.peer.addr",
  ]);

  return { sourceFile, lineNumber, requestId, userId, ipAddress };
}

export function normalizeTraceId(value: JsonValue | undefined): string | null {
  const decoded = decodeString(value);

  if (decoded === null) return null;
  const trimmed = decoded.trim();

  if (!TRACE_ID_REGEX.test(trimmed)) return null;

  return trimmed.toLowerCase();
}

export function normalizeSpanId(value: JsonValue | undefined): string | null {
  const decoded = decodeString(value);

  if (decoded === null) return null;
  const trimmed = decoded.trim();

  if (!SPAN_ID_REGEX.test(trimmed)) return null;

  return trimmed.toLowerCase();
}

export function parseOtlpAnyValue(value: JsonValue | undefined, depth = 0): JsonValue {
  if (depth > 32) return null;

  const record = decodeObject(value);

  if (record === null) return null;

  if (record.stringValue !== undefined) return record.stringValue;

  if (record.boolValue !== undefined) return record.boolValue;

  if (record.intValue !== undefined) {
    return parseIntValue(record.intValue);
  }

  if (record.doubleValue !== undefined) {
    return record.doubleValue;
  }

  if (record.arrayValue !== undefined) {
    const values = decodeObject(record.arrayValue)?.values;

    return Array.isArray(values) ? values.map((entry) => parseOtlpAnyValue(entry, depth + 1)) : [];
  }

  if (record.kvlistValue !== undefined) {
    return parseKeyValueList(decodeObject(record.kvlistValue)?.values, depth + 1);
  }

  if (record.bytesValue !== undefined) {
    return record.bytesValue;
  }

  return null;
}

function parseKeyValueList(values: JsonValue | undefined, depth = 0): JsonObject {
  if (depth > 32) return {};

  if (!Array.isArray(values)) return {};
  const record: JsonObject = {};

  for (const entry of values) {
    const entryObject = decodeObject(entry);

    if (entryObject === null) continue;
    const key = decodeString(entryObject.key);

    if (!key) continue;
    const parsedValue = entryObject.value ? parseOtlpAnyValue(entryObject.value, depth + 1) : null;
    record[key] = parsedValue;
  }

  return record;
}

function parseAttributes(values: JsonValue | undefined): JsonObject | null {
  const record = parseKeyValueList(values);

  return Object.keys(record).length > 0 ? record : null;
}

function deriveMessage(body: JsonValue | undefined, attributes: JsonObject | null): string {
  const bodyString = decodeString(body);

  if (bodyString !== null) return bodyString;

  const attrMessage = attributes?.message ?? attributes?.["log.message"];
  const attrString = decodeString(attrMessage);

  if (attrString !== null) return attrString;

  if (body === null || body === undefined) return "";

  try {
    return JSON.stringify(body);
  } catch {
    return "[unserializable body]";
  }
}

function deriveLevel(severityNumber: number | null, severityText: string | null): LogLevel {
  if (severityNumber && severityNumber > 0) {
    return severityNumberToLogLevel(severityNumber);
  }

  return severityTextToLogLevel(severityText) ?? "info";
}

export function normalizeOtlpLogsRequest(body: JsonValue | undefined): NormalizedOtlpLogsResult {
  const bodyObject = decodeObject(body);

  if (bodyObject === null) {
    throw new OtlpValidationError("Request body must be an object.");
  }

  const resourceLogs = bodyObject.resourceLogs;

  if (!Array.isArray(resourceLogs)) {
    throw new OtlpValidationError("resourceLogs must be an array.");
  }

  const records: NormalizedOtlpLogRecord[] = [];
  let rejectedLogRecords = 0;
  const errors: string[] = [];

  let recordCount = 0;

  const countEntry = () => {
    recordCount += 1;

    if (recordCount > API_CONFIG.BATCH_INSERT_LIMIT) {
      throw new BatchTooLargeError(API_CONFIG.BATCH_INSERT_LIMIT);
    }
  };

  for (const [resourceIndex, resourceLog] of resourceLogs.entries()) {
    const resourceLogObject = decodeObject(resourceLog);

    if (resourceLogObject === null) {
      countEntry();
      rejectedLogRecords += 1;
      errors.push(`Malformed resourceLog at index ${resourceIndex}`);
      continue;
    }

    const resource = decodeObject(resourceLogObject.resource);
    const resourceAttributes = parseAttributes(resource?.attributes);
    const resourceDroppedAttributesCount = parseOptionalNumber(resource?.droppedAttributesCount);

    const resourceSchemaUrl = decodeString(resourceLogObject.schemaUrl);

    const scopeLogs = Array.isArray(resourceLogObject.scopeLogs) ? resourceLogObject.scopeLogs : [];

    for (const [scopeIndex, scopeLog] of scopeLogs.entries()) {
      const scopeLogObject = decodeObject(scopeLog);

      if (scopeLogObject === null) {
        countEntry();
        rejectedLogRecords += 1;
        errors.push(`Malformed scopeLog at index ${scopeIndex}`);
        continue;
      }

      const scope = decodeObject(scopeLogObject.scope);
      const scopeName = decodeString(scope?.name);
      const scopeVersion = decodeString(scope?.version);
      const scopeAttributes = parseAttributes(scope?.attributes);
      const scopeDroppedAttributesCount = parseOptionalNumber(scope?.droppedAttributesCount);
      const scopeSchemaUrl = decodeString(scopeLogObject.schemaUrl);

      const logRecords = Array.isArray(scopeLogObject.logRecords) ? scopeLogObject.logRecords : [];

      for (const logRecord of logRecords) {
        countEntry();

        const record = decodeObject(logRecord);

        if (record === null) {
          rejectedLogRecords += 1;
          errors.push("Log record rejected: must be an object.");
          continue;
        }

        const timeUnixNano = parseUint64String(record.timeUnixNano);
        const observedTimeUnixNano = parseUint64String(record.observedTimeUnixNano);
        const severityNumber = parseSeverityNumber(record.severityNumber);
        const severityText = decodeString(record.severityText);
        const bodyValue = record.body ? parseOtlpAnyValue(record.body) : null;
        const attributes = parseAttributes(record.attributes);
        const droppedAttributesCount = parseOptionalNumber(record.droppedAttributesCount);
        const flags = parseOptionalNumber(record.flags);
        const traceId = normalizeTraceId(record.traceId);
        const spanId = normalizeSpanId(record.spanId);

        const timestamp = parseTimestamp(timeUnixNano, observedTimeUnixNano);
        const level = deriveLevel(severityNumber, severityText);
        const message = deriveMessage(bodyValue, attributes);

        if (message.includes("\u0000")) {
          rejectedLogRecords += 1;
          errors.push("Log record rejected: message cannot contain NUL characters");
          continue;
        }

        if (!message.trim()) {
          rejectedLogRecords += 1;
          errors.push(`Log record rejected: message cannot be empty`);
          continue;
        }

        records.push({
          timeUnixNano,
          observedTimeUnixNano,
          severityNumber,
          severityText,
          body: bodyValue,
          attributes,
          droppedAttributesCount,
          flags,
          traceId,
          spanId,
          resourceAttributes,
          resourceDroppedAttributesCount,
          resourceSchemaUrl,
          scopeName,
          scopeVersion,
          scopeAttributes,
          scopeDroppedAttributesCount,
          scopeSchemaUrl,
          message,
          level,
          timestamp,
        });
      }
    }
  }

  return { records, rejectedLogRecords, errors };
}

export function parseOtlpIngestBody(body: JsonValue | undefined): ParsedIngest {
  const normalized = normalizeOtlpLogsRequest(body);

  return {
    inputs: normalized.records.map((record) => {
      const mapped = mapOtlpAttributesToLogColumns(record.attributes);

      return {
        ...mapped,
        level: record.level,
        message: record.message,
        timestamp: record.timestamp,
        metadata: record.attributes,
        resourceAttributes: record.resourceAttributes,
        timeUnixNano: record.timeUnixNano,
        observedTimeUnixNano: record.observedTimeUnixNano,
        severityNumber: record.severityNumber,
        severityText: record.severityText,
        body: record.body,
        droppedAttributesCount: record.droppedAttributesCount,
        flags: record.flags,
        traceId: record.traceId,
        spanId: record.spanId,
        resourceDroppedAttributesCount: record.resourceDroppedAttributesCount,
        resourceSchemaUrl: record.resourceSchemaUrl,
        scopeName: record.scopeName,
        scopeVersion: record.scopeVersion,
        scopeAttributes: record.scopeAttributes,
        scopeDroppedAttributesCount: record.scopeDroppedAttributesCount,
        scopeSchemaUrl: record.scopeSchemaUrl,
      };
    }),
    accepted: normalized.records.length,
    rejected: normalized.rejectedLogRecords,
    errors: normalized.errors,
  };
}
