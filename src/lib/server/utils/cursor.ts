import { sql, type Column, type SQL } from "drizzle-orm";

const DECIMAL_INTEGER = /^-?\d+$/;

const MISSING_TIMESTAMP_ERROR = "Cannot encode cursor for log without timestamp";

export function microsColumn(col: Column): SQL<string> {
  return sql<string>`(extract(epoch from ${col}) * 1000000)::bigint::text`;
}

// NOTE: split seconds and microseconds because to_timestamp() takes a double precision
// argument, which cannot represent microsecond precision beyond ~year 2100.
function microsTimestamp(micros: string): SQL {
  return sql`to_timestamp(trunc(${micros}::numeric / 1000000)::float8)
      + ((${micros}::numeric % 1000000) * interval '1 microsecond')`;
}

export function cursorRowLessThan(col: Column, idCol: Column, micros: string, id: string): SQL {
  return sql`(${col}, ${idCol}) < (${microsTimestamp(micros)}, ${id})`;
}

export function cursorRowGreaterThan(col: Column, idCol: Column, micros: string, id: string): SQL {
  return sql`(${col}, ${idCol}) > (${microsTimestamp(micros)}, ${id})`;
}

export function encodeCursor(micros: string | number, id: string): string;

export function encodeCursor(timestamp: Date | null | undefined, id: string): string;

export function encodeCursor(
  microsOrTimestamp: string | number | Date | null | undefined,
  id: string,
): string {
  let micros: string;

  if (microsOrTimestamp instanceof Date) {
    const time = microsOrTimestamp.getTime();

    if (Number.isNaN(time)) throw new Error(MISSING_TIMESTAMP_ERROR);
    micros = String(time * 1000);
  } else if (typeof microsOrTimestamp === "string") {
    micros = microsOrTimestamp;
  } else if (typeof microsOrTimestamp === "number" && !Number.isNaN(microsOrTimestamp)) {
    micros = String(microsOrTimestamp);
  } else {
    throw new Error(MISSING_TIMESTAMP_ERROR);
  }

  if (!DECIMAL_INTEGER.test(micros)) {
    throw new Error(`Cannot encode cursor: micros must be a decimal integer, got "${micros}"`);
  }

  return Buffer.from(`${micros}_${id}`).toString("base64url");
}

export interface DecodedCursor {
  /** Exact epoch microseconds, as an integer string — Postgres timestamptz precision. */
  micros: string;
  id: string;
  /** Convenience value, millisecond-truncated; best-effort beyond the JS Date range. */
  timestamp: Date;
}

export function decodeCursor(cursor: string): DecodedCursor {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf-8");

    const separatorIndex = decoded.indexOf("_");

    if (separatorIndex === -1) {
      throw new Error("Invalid cursor format: missing separator");
    }

    const micros = decoded.substring(0, separatorIndex);
    const id = decoded.substring(separatorIndex + 1);

    if (!micros || !id) {
      throw new Error("Invalid cursor format: empty micros or id");
    }

    if (!DECIMAL_INTEGER.test(micros)) {
      throw new Error("Invalid cursor format: invalid micros");
    }

    return { micros, id, timestamp: new Date(Math.floor(Number(micros) / 1000)) };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Invalid cursor")) {
      throw error;
    }

    throw new Error("Invalid cursor");
  }
}
