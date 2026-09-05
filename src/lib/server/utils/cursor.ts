import { sql, type Column, type SQL } from "drizzle-orm";

export function microsColumn(col: Column): SQL<number> {
  return sql<number>`(extract(epoch from ${col}) * 1000000)::float8`;
}

export function cursorRowLessThan(col: Column, idCol: Column, micros: number, id: string): SQL {
  return sql`(${col}, ${idCol}) < (to_timestamp(${micros} / 1000000.0), ${id})`;
}

export function encodeCursor(micros: number, id: string): string;

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
  timestamp: Date;
}

export function decodeCursor(cursor: string): DecodedCursor {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf-8");

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
