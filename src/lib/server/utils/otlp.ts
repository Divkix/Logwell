import type { LogLevel } from "$lib/shared/types";
import { API_CONFIG } from "../config/performance";
import type { ParsedIngest } from "./ingest";

export class OtlpValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OtlpValidationError";
  }
}

export class OtlpBatchTooLargeError extends OtlpValidationError {
  constructor(limit: number) {
    super(`Batch exceeds maximum limit of ${limit} logs.`);
    this.name = "OtlpBatchTooLargeError";
  }
}

type OtlpAnyValue = {
  stringValue?: string;
  boolValue?: boolean;
  intValue?: string | number;
  doubleValue?: number;
  arrayValue?: { values?: OtlpAnyValue[] };
  kvlistValue?: { values?: OtlpKeyValue[] };
  bytesValue?: string;
};

type OtlpKeyValue = {
  key?: string;
  value?: OtlpAnyValue;
};

type OtlpLogRecord = {
  timeUnixNano?: string | number;
  observedTimeUnixNano?: string | number;
  severityNumber?: number | string;
  severityText?: string;
  body?: OtlpAnyValue;
  attributes?: OtlpKeyValue[];
  droppedAttributesCount?: number;
  flags?: number;
  traceId?: string;
  spanId?: string;
};

type OtlpScope = {
  name?: string;
  version?: string;
  attributes?: OtlpKeyValue[];
  droppedAttributesCount?: number;
};

type OtlpResource = {
  attributes?: OtlpKeyValue[];
  droppedAttributesCount?: number;
};

export type NormalizedOtlpLogRecord = {
  timeUnixNano: string | null;
  observedTimeUnixNano: string | null;
  severityNumber: number | null;
  severityText: string | null;
  body: unknown;
  attributes: Record<string, unknown> | null;
  droppedAttributesCount: number | null;
  flags: number | null;
  traceId: string | null;
  spanId: string | null;
  resourceAttributes: Record<string, unknown> | null;
  resourceDroppedAttributesCount: number | null;
  resourceSchemaUrl: string | null;
  scopeName: string | null;
  scopeVersion: string | null;
  scopeAttributes: Record<string, unknown> | null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampInt32(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const t = Math.trunc(value);
  if (t < -2147483648 || t > 2147483647) return null;
  return t;
}

export function parseUint64String(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (!/^\d+$/.test(trimmed)) return null;
    return trimmed;
  }
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
  ) {
    return Math.trunc(value).toString();
  }
  return null;
}

function parseOptionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clampInt32(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? clampInt32(parsed) : null;
  }
  return null;
}

function parseIntValue(value: unknown): number | string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isSafeInteger(value) ? value : Math.trunc(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
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

function parseSeverityNumber(value: unknown): number | null {
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

function attributeString(
  attributes: Record<string, unknown> | null,
  keys: string[],
): string | null {
  if (!attributes) return null;
  for (const key of keys) {
    const value = attributes[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
}

function attributeInt(attributes: Record<string, unknown> | null, keys: string[]): number | null {
  if (!attributes) return null;
  for (const key of keys) {
    const value = attributes[key];
    if (typeof value === "number" && Number.isSafeInteger(value)) {
      return value > 0 ? clampInt32(value) : null;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number.parseInt(value, 10);
      if (Number.isSafeInteger(parsed)) {
        return parsed > 0 ? clampInt32(parsed) : null;
      }
    }
  }
  return null;
}

export function mapOtlpAttributesToLogColumns(attributes: Record<string, unknown> | null) {
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

export function normalizeTraceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!TRACE_ID_REGEX.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function normalizeSpanId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!SPAN_ID_REGEX.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function parseOtlpAnyValue(value: OtlpAnyValue, depth = 0): unknown {
  if (depth > 32) return null;
  if (!isRecord(value)) return null;

  if (value.stringValue !== undefined) return value.stringValue;
  if (value.boolValue !== undefined) return value.boolValue;

  if (value.intValue !== undefined) {
    return parseIntValue(value.intValue);
  }

  if (value.doubleValue !== undefined) {
    return value.doubleValue;
  }

  if (value.arrayValue !== undefined) {
    const values = Array.isArray(value.arrayValue?.values) ? (value.arrayValue?.values ?? []) : [];
    return values.map((entry) => parseOtlpAnyValue(entry, depth + 1));
  }

  if (value.kvlistValue !== undefined) {
    return parseKeyValueList(value.kvlistValue?.values, depth + 1);
  }

  if (value.bytesValue !== undefined) {
    return value.bytesValue;
  }

  return null;
}

function parseKeyValueList(values?: OtlpKeyValue[], depth = 0): Record<string, unknown> {
  if (depth > 32) return {};
  if (!Array.isArray(values)) return {};
  const record: Record<string, unknown> = {};
  for (const entry of values) {
    if (!isRecord(entry)) continue;
    const key = typeof entry.key === "string" ? entry.key : null;
    if (!key) continue;
    const parsedValue = entry.value ? parseOtlpAnyValue(entry.value, depth + 1) : null;
    record[key] = parsedValue;
  }
  return record;
}

function parseAttributes(values?: OtlpKeyValue[]): Record<string, unknown> | null {
  const record = parseKeyValueList(values);
  return Object.keys(record).length > 0 ? record : null;
}

function deriveMessage(body: unknown, attributes: Record<string, unknown> | null): string {
  if (typeof body === "string") return body;
  const attrMessage = attributes?.message ?? attributes?.["log.message"];
  if (typeof attrMessage === "string") return attrMessage;
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

export function normalizeOtlpLogsRequest(body: unknown): NormalizedOtlpLogsResult {
  if (!isRecord(body)) {
    throw new OtlpValidationError("Request body must be an object.");
  }

  const resourceLogs = body.resourceLogs;
  if (!Array.isArray(resourceLogs)) {
    throw new OtlpValidationError("resourceLogs must be an array.");
  }

  const records: NormalizedOtlpLogRecord[] = [];
  let rejectedLogRecords = 0;
  const errors: string[] = [];

  let recordCount = 0;

  for (const [resourceIndex, resourceLog] of resourceLogs.entries()) {
    if (!isRecord(resourceLog)) {
      rejectedLogRecords += 1;
      errors.push(`Malformed resourceLog at index ${resourceIndex}`);
      continue;
    }

    const resource = isRecord(resourceLog.resource) ? (resourceLog.resource as OtlpResource) : null;
    const resourceAttributes = parseAttributes(resource?.attributes);
    const resourceDroppedAttributesCount = parseOptionalNumber(resource?.droppedAttributesCount);
    const resourceSchemaUrl =
      typeof resourceLog.schemaUrl === "string" ? resourceLog.schemaUrl : null;

    const scopeLogs = Array.isArray(resourceLog.scopeLogs) ? resourceLog.scopeLogs : [];

    for (const [scopeIndex, scopeLog] of scopeLogs.entries()) {
      if (!isRecord(scopeLog)) {
        rejectedLogRecords += 1;
        errors.push(`Malformed scopeLog at index ${scopeIndex}`);
        continue;
      }

      const scope = isRecord(scopeLog.scope) ? (scopeLog.scope as OtlpScope) : null;
      const scopeName = typeof scope?.name === "string" ? scope.name : null;
      const scopeVersion = typeof scope?.version === "string" ? scope.version : null;
      const scopeAttributes = parseAttributes(scope?.attributes);
      const scopeDroppedAttributesCount = parseOptionalNumber(scope?.droppedAttributesCount);
      const scopeSchemaUrl = typeof scopeLog.schemaUrl === "string" ? scopeLog.schemaUrl : null;

      const logRecords = Array.isArray(scopeLog.logRecords) ? scopeLog.logRecords : [];

      for (const logRecord of logRecords) {
        if (!isRecord(logRecord)) {
          rejectedLogRecords += 1;
          errors.push("Log record rejected: must be an object.");
          continue;
        }

        const record = logRecord as OtlpLogRecord;
        const timeUnixNano = parseUint64String(record.timeUnixNano);
        const observedTimeUnixNano = parseUint64String(record.observedTimeUnixNano);
        const severityNumber = parseSeverityNumber(record.severityNumber);
        const severityText = typeof record.severityText === "string" ? record.severityText : null;
        const bodyValue = record.body ? parseOtlpAnyValue(record.body) : null;
        const attributes = parseAttributes(record.attributes);
        const droppedAttributesCount = parseOptionalNumber(record.droppedAttributesCount);
        const flags = parseOptionalNumber(record.flags);
        const traceId = normalizeTraceId(record.traceId);
        const spanId = normalizeSpanId(record.spanId);

        const timestamp = parseTimestamp(timeUnixNano, observedTimeUnixNano);
        const level = deriveLevel(severityNumber, severityText);
        const message = deriveMessage(bodyValue, attributes);

        if (!message.trim()) {
          rejectedLogRecords += 1;
          errors.push(`Log record rejected: message cannot be empty`);
          continue;
        }

        recordCount += 1;
        if (recordCount > API_CONFIG.BATCH_INSERT_LIMIT) {
          throw new OtlpBatchTooLargeError(API_CONFIG.BATCH_INSERT_LIMIT);
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

export function parseOtlpIngestBody(body: unknown): ParsedIngest {
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
