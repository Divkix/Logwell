import type { LogLevel } from '$lib/shared/types';

export class OtlpValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OtlpValidationError';
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
  body: unknown | null;
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
};

const TRACE_ID_REGEX = /^[0-9a-f]{32}$/i;
const SPAN_ID_REGEX = /^[0-9a-f]{16}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseUint64String(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (!/^-?\d+$/.test(trimmed)) return null;
    return trimmed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value).toString();
  }
  return null;
}

function parseOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseIntValue(value: unknown): number | string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isSafeInteger(value) ? value : Math.trunc(value);
  }
  if (typeof value === 'string') {
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

function parseTimestamp(timeUnixNano: string | null, observedTimeUnixNano: string | null): Date {
  const candidate = timeUnixNano ?? observedTimeUnixNano;
  if (!candidate) {
    return new Date();
  }
  try {
    const nanos = BigInt(candidate);
    const millis = Number(nanos / 1000000n);
    return new Date(millis);
  } catch {
    return new Date();
  }
}

function parseSeverityNumber(value: unknown): number | null {
  const numberValue = parseOptionalNumber(value);
  if (numberValue === null) return null;
  const rounded = Math.trunc(numberValue);
  if (rounded < 0) return null;
  return rounded;
}

function severityTextToLogLevel(value: string | null): LogLevel | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized.includes('fatal') || normalized.includes('critical')) return 'fatal';
  if (normalized.includes('error')) return 'error';
  if (normalized.includes('warn')) return 'warn';
  if (normalized.includes('info')) return 'info';
  if (normalized.includes('debug') || normalized.includes('trace')) return 'debug';
  return null;
}

export function severityNumberToLogLevel(value: number | null | undefined): LogLevel {
  if (!value || value <= 0) {
    return 'info';
  }
  if (value <= 8) {
    return 'debug';
  }
  if (value <= 12) {
    return 'info';
  }
  if (value <= 16) {
    return 'warn';
  }
  if (value <= 20) {
    return 'error';
  }
  return 'fatal';
}

export function logLevelToSeverityNumber(level: LogLevel): number {
  switch (level) {
    case 'debug':
      return 5;
    case 'info':
      return 9;
    case 'warn':
      return 13;
    case 'error':
      return 17;
    case 'fatal':
      return 21;
  }
}

export function dateToUnixNanoString(date: Date): string {
  return (BigInt(date.getTime()) * 1000000n).toString();
}

function attributeString(
  attributes: Record<string, unknown> | null,
  keys: string[],
): string | null {
  if (!attributes) return null;
  for (const key of keys) {
    const value = attributes[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return null;
}

function attributeInt(attributes: Record<string, unknown> | null, keys: string[]): number | null {
  if (!attributes) return null;
  for (const key of keys) {
    const value = attributes[key];
    if (typeof value === 'number' && Number.isSafeInteger(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number.parseInt(value, 10);
      if (Number.isSafeInteger(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

export function mapOtlpAttributesToLogColumns(attributes: Record<string, unknown> | null) {
  const sourceFile = attributeString(attributes, ['code.filepath', 'source.file', 'source_file']);
  const lineNumber = attributeInt(attributes, ['code.lineno', 'source.line', 'line_number']);
  const requestId = attributeString(attributes, ['request.id', 'request_id', 'http.request_id']);
  const userId = attributeString(attributes, ['enduser.id', 'user.id', 'user_id']);
  const ipAddress = attributeString(attributes, [
    'client.address',
    'ip',
    'ip_address',
    'net.peer.ip',
    'net.sock.peer.addr',
  ]);

  return { sourceFile, lineNumber, requestId, userId, ipAddress };
}

export function normalizeTraceId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!TRACE_ID_REGEX.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function normalizeSpanId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!SPAN_ID_REGEX.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function parseOtlpAnyValue(value: OtlpAnyValue): unknown {
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
    return values.map((entry) => parseOtlpAnyValue(entry));
  }

  if (value.kvlistValue !== undefined) {
    return parseKeyValueList(value.kvlistValue?.values);
  }

  if (value.bytesValue !== undefined) {
    return value.bytesValue;
  }

  return null;
}

function parseKeyValueList(values?: OtlpKeyValue[]): Record<string, unknown> {
  if (!Array.isArray(values)) return {};
  const record: Record<string, unknown> = {};
  for (const entry of values) {
    if (!isRecord(entry)) continue;
    const key = typeof entry.key === 'string' ? entry.key : null;
    if (!key) continue;
    const parsedValue = entry.value ? parseOtlpAnyValue(entry.value) : null;
    record[key] = parsedValue;
  }
  return record;
}

function parseAttributes(values?: OtlpKeyValue[]): Record<string, unknown> | null {
  const record = parseKeyValueList(values);
  return Object.keys(record).length > 0 ? record : null;
}

function deriveMessage(body: unknown | null, attributes: Record<string, unknown> | null): string {
  if (typeof body === 'string') return body;
  const attrMessage = attributes?.message ?? attributes?.['log.message'];
  if (typeof attrMessage === 'string') return attrMessage;
  if (body === null || body === undefined) return '';
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

function deriveLevel(severityNumber: number | null, severityText: string | null): LogLevel {
  if (severityNumber && severityNumber > 0) {
    return severityNumberToLogLevel(severityNumber);
  }
  return severityTextToLogLevel(severityText) ?? 'info';
}

export function normalizeOtlpLogsRequest(body: unknown): NormalizedOtlpLogsResult {
  if (!isRecord(body)) {
    throw new OtlpValidationError('Request body must be an object.');
  }

  const resourceLogs = body.resourceLogs;
  if (!Array.isArray(resourceLogs)) {
    throw new OtlpValidationError('resourceLogs must be an array.');
  }

  const records: NormalizedOtlpLogRecord[] = [];
  let rejectedLogRecords = 0;

  for (const resourceLog of resourceLogs) {
    if (!isRecord(resourceLog)) {
      continue;
    }

    const resource = isRecord(resourceLog.resource) ? (resourceLog.resource as OtlpResource) : null;
    const resourceAttributes = parseAttributes(resource?.attributes);
    const resourceDroppedAttributesCount = parseOptionalNumber(resource?.droppedAttributesCount);
    const resourceSchemaUrl =
      typeof resourceLog.schemaUrl === 'string' ? resourceLog.schemaUrl : null;

    const scopeLogs = Array.isArray(resourceLog.scopeLogs) ? resourceLog.scopeLogs : [];

    for (const scopeLog of scopeLogs) {
      if (!isRecord(scopeLog)) {
        continue;
      }

      const scope = isRecord(scopeLog.scope) ? (scopeLog.scope as OtlpScope) : null;
      const scopeName = typeof scope?.name === 'string' ? scope.name : null;
      const scopeVersion = typeof scope?.version === 'string' ? scope.version : null;
      const scopeAttributes = parseAttributes(scope?.attributes);
      const scopeDroppedAttributesCount = parseOptionalNumber(scope?.droppedAttributesCount);
      const scopeSchemaUrl = typeof scopeLog.schemaUrl === 'string' ? scopeLog.schemaUrl : null;

      const logRecords = Array.isArray(scopeLog.logRecords) ? scopeLog.logRecords : [];

      for (const logRecord of logRecords) {
        if (!isRecord(logRecord)) {
          rejectedLogRecords += 1;
          continue;
        }

        const record = logRecord as OtlpLogRecord;
        const timeUnixNano = parseUint64String(record.timeUnixNano);
        const observedTimeUnixNano = parseUint64String(record.observedTimeUnixNano);
        const severityNumber = parseSeverityNumber(record.severityNumber);
        const severityText = typeof record.severityText === 'string' ? record.severityText : null;
        const bodyValue = record.body ? parseOtlpAnyValue(record.body) : null;
        const attributes = parseAttributes(record.attributes);
        const droppedAttributesCount = parseOptionalNumber(record.droppedAttributesCount);
        const flags = parseOptionalNumber(record.flags);
        const traceId = normalizeTraceId(record.traceId);
        const spanId = normalizeSpanId(record.spanId);

        const timestamp = parseTimestamp(timeUnixNano, observedTimeUnixNano);
        const level = deriveLevel(severityNumber, severityText);
        const message = deriveMessage(bodyValue, attributes);

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

  return { records, rejectedLogRecords };
}
