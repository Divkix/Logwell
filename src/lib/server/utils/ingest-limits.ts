import { parseEnvInt } from "#lib/server/config/performance.js";
import type { JsonValue } from "#lib/shared/schemas/json.js";

/**
 * Per-record limits shared by both ingest parsers.
 *
 * Every record's message and JSON columns feed the generated `search` tsvector, whose lexemes
 * PostgreSQL caps at 1 MB: one oversized record would fail the whole batch's INSERT with a 500.
 * Worst case (distinct multi-byte tokens) that cap is reached from roughly 300K characters of
 * input, so a record's searchable text is kept to 256K characters: message and string body at
 * most MAX_LOG_MESSAGE_LENGTH each, structured JSON at most MAX_LOG_JSON_LENGTH.
 */

/**
 * Longest stored log message or string body, in characters (UTF-16 code units). Longer text is
 * truncated with a marker giving its original length, not rejected, so a long stack trace is
 * still stored.
 */
export const MAX_LOG_MESSAGE_LENGTH = 98_304;

/**
 * Largest accepted combined serialized length of a record's structured JSON columns, in
 * characters. JSON cannot be cut without changing its meaning, so a record over this is rejected
 * individually (200 with an entry in `errors[]`).
 */
export const MAX_LOG_JSON_LENGTH = 65_536;

/** Cuts `text` to MAX_LOG_MESSAGE_LENGTH, ending it with a marker that records the original length. */
export function truncateLogText(text: string): string {
  if (text.length <= MAX_LOG_MESSAGE_LENGTH) return text;

  const marker = `… [truncated, ${text.length} characters]`;
  let end = MAX_LOG_MESSAGE_LENGTH - marker.length;
  const last = text.charCodeAt(end - 1);

  // Never leave the high half of a surrogate pair dangling before the marker.
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;

  return text.slice(0, end) + marker;
}

/**
 * Why a record's structured JSON is too large to store, or null when it fits.
 *
 * @param jsonColumns The record's JSON columns (non-string body, attributes/metadata, resource
 *   and scope attributes), measured together because they are concatenated into one tsvector.
 */
export function logRecordJsonSizeError(jsonColumns: JsonValue[]): string | null {
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
 * Earliest stored timestamp, 0001-01-01T00:00:00Z. PostgreSQL's timestamptz reaches back to
 * 4713 BC, but drizzle binds a Date as `toISOString()`, whose expanded-year form for year 0 and
 * earlier (`0000-…`, `-000001-…`) PostgreSQL rejects: one such record would fail the whole
 * batch's INSERT with a 500.
 */
export const MIN_LOG_TIMESTAMP_MS = Date.parse("0001-01-01T00:00:00Z");

/**
 * Replaces a client-supplied timestamp outside the storable window with `now`, the receive time
 * an unparseable timestamp also falls back to.
 *
 * - More than MAX_FUTURE_SKEW_MS ahead: a far-future record would otherwise sit at the top of
 *   every newest-first view, keep its incident's time-derived status open until that date, and
 *   outlive retention cleanup.
 * - Before MIN_LOG_TIMESTAMP_MS: PostgreSQL would reject the whole batch.
 */
export function clampLogTimestamp(timestamp: Date, now = Date.now()): Date {
  const time = timestamp.getTime();

  return time < MIN_LOG_TIMESTAMP_MS || time - now > MAX_FUTURE_SKEW_MS ? new Date(now) : timestamp;
}
