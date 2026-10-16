import { sql, type Column, type SQL } from "drizzle-orm";
import { z } from "zod";

const DECIMAL_INTEGER = /^-?\d+$/;

const MISSING_TIMESTAMP_ERROR = "Cannot encode cursor for log without timestamp";

// Epoch-microsecond bounds of timestamps a stored row can hold: PostgreSQL's timestamptz floor
// (4713-01-01 BC) and the JS Date ceiling (+275760-09-13, 8.64e15 ms), since every row timestamp
// is written from a Date. A decoded cursor outside them could only make to_timestamp() raise
// "timestamp out of range" (a 500), so it is rejected as malformed instead.
const MIN_CURSOR_MICROS = -210_866_803_200_000_000n;

const MAX_CURSOR_MICROS = 8_640_000_000_000_000_000n;

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

export function encodeCursor(
  microsOrTimestamp: string | number | Date | null | undefined,
  id: string,
): string {
  let micros: string;

  if (microsOrTimestamp instanceof Date) {
    const time = microsOrTimestamp.getTime();

    if (Number.isNaN(time)) throw new Error(MISSING_TIMESTAMP_ERROR);
    micros = String(time * 1000);
  } else {
    // z.number() is finite-only in zod 4, so the ±Infinity literals keep
    // non-finite numbers flowing to the DECIMAL_INTEGER check below, exactly as
    // the original non-NaN number branch did. NaN fails every arm of this union
    // and stays on the missing-timestamp error.
    const decoded = z
      .union([z.string(), z.number(), z.literal(Infinity), z.literal(-Infinity)])
      .safeParse(microsOrTimestamp);

    if (!decoded.success) {
      throw new Error(MISSING_TIMESTAMP_ERROR);
    }

    micros = String(decoded.data);
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

    const value = BigInt(micros);

    if (value < MIN_CURSOR_MICROS || value > MAX_CURSOR_MICROS) {
      throw new Error("Invalid cursor format: micros out of range");
    }

    return { micros, id, timestamp: new Date(Math.floor(Number(micros) / 1000)) };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Invalid cursor")) {
      throw error;
    }

    throw new Error("Invalid cursor");
  }
}
