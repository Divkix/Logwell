import { LOG_LEVELS, type LogLevel } from "../../shared/schemas/log";
import { mapOtlpAttributesToLogColumns } from "./otlp";

export interface SimpleLogInput {
  level: string;
  message: string;
  timestamp?: string;
  service?: string;
  metadata?: Record<string, unknown>;
  sourceFile?: string;
  lineNumber?: number;
}

export interface NormalizedSimpleLog {
  level: LogLevel;
  message: string;
  timestamp: Date;
  resourceAttributes: { "service.name": string } | null;
  metadata: Record<string, unknown> | null;
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

function isValidLevel(level: unknown): level is LogLevel {
  return typeof level === "string" && LOG_LEVELS.includes(level as LogLevel);
}

function parseTimestamp(timestamp: unknown): Date {
  if (!timestamp || typeof timestamp !== "string") {
    return new Date();
  }

  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }

  return parsed;
}

function validateLogEntry(
  input: unknown,
  index: number,
): { log: NormalizedSimpleLog; error: null } | { log: null; error: string } {
  if (!input || typeof input !== "object") {
    return { log: null, error: `Entry at index ${index}: must be an object` };
  }

  const entry = input as Record<string, unknown>;

  if (!("level" in entry)) {
    return { log: null, error: `Entry at index ${index}: missing required field 'level'` };
  }
  if (!isValidLevel(entry.level)) {
    return {
      log: null,
      error: `Entry at index ${index}: invalid level '${String(entry.level)}' (must be one of: ${LOG_LEVELS.join(", ")})`,
    };
  }

  if (!("message" in entry)) {
    return { log: null, error: `Entry at index ${index}: missing required field 'message'` };
  }
  if (typeof entry.message !== "string") {
    return { log: null, error: `Entry at index ${index}: message must be a string` };
  }
  if (entry.message.trim() === "") {
    return { log: null, error: `Entry at index ${index}: message cannot be empty` };
  }

  const timestamp = parseTimestamp(entry.timestamp);
  const service = typeof entry.service === "string" ? entry.service : null;
  const rawMetadata =
    entry.metadata && typeof entry.metadata === "object" && !Array.isArray(entry.metadata)
      ? (entry.metadata as Record<string, unknown>)
      : null;
  const metadata = rawMetadata && Object.keys(rawMetadata).length > 0 ? rawMetadata : null;
  const sourceFile = typeof entry.sourceFile === "string" ? entry.sourceFile : null;
  const lineNumber =
    typeof entry.lineNumber === "number" &&
    Number.isInteger(entry.lineNumber) &&
    entry.lineNumber > 0 &&
    entry.lineNumber <= 2147483647
      ? entry.lineNumber
      : null;

  const mapped = mapOtlpAttributesToLogColumns(metadata);

  return {
    log: {
      level: entry.level as LogLevel,
      message: entry.message,
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

export function parseSimpleIngestRequest(body: unknown): SimpleIngestResult {
  if (body === null || body === undefined) {
    throw new SimpleIngestError("Request body cannot be empty");
  }

  const entries = Array.isArray(body) ? body : [body];

  if (entries.length === 0) {
    throw new SimpleIngestError("Request body cannot be an empty array");
  }

  const records: NormalizedSimpleLog[] = [];
  const errors: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const result = validateLogEntry(entries[i], i);
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
