import { parseEnvInt } from "#lib/server/config/performance.js";
import type { JsonValue } from "#lib/shared/schemas/json.js";

/**
 * Per-record limits shared by both ingest parsers.
 *
 * Every record's message and JSON columns feed the generated `search` tsvector, which PostgreSQL
 * caps at 1 MB: one oversized record would fail the whole batch's INSERT with a 500. Records over
 * these limits are rejected individually instead (200 with an entry in `errors[]`), keeping the
 * searchable text of a record a few hundred KB at most regardless of BODY_SIZE_LIMIT.
 */

/** Longest accepted log message, in characters (UTF-16 code units). */
export const MAX_LOG_MESSAGE_LENGTH = 32_768;

/** Largest accepted combined serialized length of a record's JSON columns, in characters. */
export const MAX_LOG_JSON_LENGTH = 65_536;

/**
 * Why a record is too large to store, or null when it fits.
 *
 * @param jsonColumns The record's JSON columns (body, attributes/metadata, resource and scope
 *   attributes), measured together because they are concatenated into one tsvector.
 */
export function logRecordSizeError(message: string, jsonColumns: JsonValue[]): string | null {
  if (message.length > MAX_LOG_MESSAGE_LENGTH) {
    return `message exceeds ${MAX_LOG_MESSAGE_LENGTH} characters (got ${message.length})`;
  }

  let jsonLength = 0;

  for (const value of jsonColumns) {
    jsonLength += JSON.stringify(value).length;

    if (jsonLength > MAX_LOG_JSON_LENGTH) {
      return `body and attributes exceed ${MAX_LOG_JSON_LENGTH} characters when serialized`;
    }
  }

  return null;
}

/**
 * How far past the server's clock a record's timestamp may be (env `INGEST_MAX_FUTURE_SKEW_MS`,
 * default 5 minutes) before it is clamped to the receive time.
 */
export const MAX_FUTURE_SKEW_MS = parseEnvInt("INGEST_MAX_FUTURE_SKEW_MS", 300_000);

/**
 * Clamps a client-supplied timestamp that lies more than MAX_FUTURE_SKEW_MS ahead to `now`.
 *
 * A far-future record would otherwise sit at the top of every newest-first view, keep its
 * incident's time-derived status open until that date, and outlive retention cleanup.
 */
export function clampFutureTimestamp(timestamp: Date, now = Date.now()): Date {
  return timestamp.getTime() - now > MAX_FUTURE_SKEW_MS ? new Date(now) : timestamp;
}
