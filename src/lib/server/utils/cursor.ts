/**
 * Cursor utilities for pagination
 *
 * Implements cursor-based pagination using base64url-encoded microsecond
 * timestamps and IDs. Microsecond resolution is required so pagination can
 * tie-break rows that share the same millisecond without skipping any: the
 * previous format truncated the timestamp to milliseconds, which made the
 * `timestamp = <cursorTs>` equality check miss rows with sub-millisecond
 * values and silently skip them.
 *
 * Format: base64url(<micros>_<id>)
 * where <micros> is an integer count of microseconds since the Unix epoch.
 */

import { sql, type Column, type SQL } from "drizzle-orm";

/**
 * Selectable microsecond-epoch expression for a timestamp column.
 *
 * Produces `(extract(epoch from <col>) * 1000000)::float8` — the exact
 * microsecond value to pass to `encodeCursor` so cursors carry true
 * sub-millisecond precision. Co-locating the expression here keeps the
 * precision math in sync with `cursorRowLessThan` and `encodeCursor`.
 */
export function microsColumn(col: Column): SQL<number> {
  return sql<number>`(extract(epoch from ${col}) * 1000000)::float8`;
}

/**
 * Row-value `<` predicate for keyset pagination: `(col, idCol) < (micros, id)`.
 *
 * Comparing the full row (instead of a millisecond-truncated timestamp with
 * an id tie-break) means rows that share the cursor's millisecond are
 * tie-broken on id and never skipped. `micros` is the decoded cursor's exact
 * microsecond timestamp; `id` is the decoded cursor's id.
 */
export function cursorRowLessThan(col: Column, idCol: Column, micros: number, id: string): SQL {
  return sql`(${col}, ${idCol}) < (to_timestamp(${micros} / 1000000.0), ${id})`;
}

/**
 * Encodes a cursor from a microsecond timestamp and an ID.
 *
 * Callers that query against Postgres should select {@link microsColumn}
 * alongside their rows and round it (it is exactly representable) before
 * passing it here, so the cursor carries true microsecond precision.
 *
 * @param micros - Integer microseconds since the Unix epoch
 * @param id - The row ID
 * @returns Base64url-encoded cursor string
 */
export function encodeCursor(micros: number, id: string): string;

/**
 * Encodes a cursor from a millisecond-precision Date and an ID.
 *
 * Kept for callers that only hold a `Date` (e.g. page loaders): the Date is
 * converted to microseconds via `ms * 1000`. Routes that need true
 * microsecond precision must pass the number overload instead.
 *
 * @param timestamp - The row timestamp (must not be null)
 * @param id - The row ID
 * @returns Base64url-encoded cursor string
 * @throws Error if timestamp is null or undefined
 */
export function encodeCursor(timestamp: Date | null | undefined, id: string): string;

export function encodeCursor(
  microsOrTimestamp: number | Date | null | undefined,
  id: string,
): string {
  let micros: number | null;
  if (typeof microsOrTimestamp === "number") {
    micros = Number.isFinite(microsOrTimestamp) ? Math.round(microsOrTimestamp) : null;
  } else if (microsOrTimestamp instanceof Date) {
    micros = Number.isNaN(microsOrTimestamp.getTime()) ? null : microsOrTimestamp.getTime() * 1000;
  } else {
    micros = null;
  }

  if (micros === null) {
    throw new Error("Cannot encode cursor for log without timestamp");
  }
  return Buffer.from(`${micros}_${id}`).toString("base64url");
}

export interface DecodedCursor {
  micros: number;
  id: string;
  /**
   * Millisecond-truncated convenience view of `micros` for callers that
   * compare against a Date (e.g. page loaders). Prefer the exact `micros`
   * for row-value comparisons.
   */
  timestamp: Date;
}

/**
 * Decodes a cursor back to microsecond timestamp and ID.
 *
 * @param cursor - Base64url-encoded cursor string
 * @returns Decoded cursor (micros is exact; timestamp is ms-truncated)
 * @throws Error if cursor format is invalid
 */
export function decodeCursor(cursor: string): DecodedCursor {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf-8");

    // Format is `<micros>_<id>`; micros is a plain integer so the first
    // underscore separates it from the ID (which may contain underscores).
    const separatorIndex = decoded.indexOf("_");

    if (separatorIndex === -1) {
      throw new Error("Invalid cursor format: missing separator");
    }

    const microsStr = decoded.substring(0, separatorIndex);
    const id = decoded.substring(separatorIndex + 1);

    if (!microsStr || !id) {
      throw new Error("Invalid cursor format: empty micros or id");
    }

    const micros = Number(microsStr);
    if (!Number.isSafeInteger(micros)) {
      throw new Error("Invalid cursor format: invalid micros");
    }

    return { micros, id, timestamp: new Date(Math.floor(micros / 1000)) };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Invalid cursor")) {
      throw error;
    }
    throw new Error("Invalid cursor");
  }
}
