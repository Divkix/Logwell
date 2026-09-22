import { describe, expect, it } from "vite-plus/test";
import { decodeCursor, encodeCursor } from "./cursor";

const TS = new Date("2024-01-15T10:30:00.000Z");

describe("cursor utilities", () => {
  describe("encodeCursor", () => {
    it("creates a valid base64url string", () => {
      const cursor = encodeCursor(TS, "log_123");
      expect(cursor).toBeTruthy();
      expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it.each([
      ["log_123"],
      ["log_with_underscores_123"],
      ["log_456"],
      ["log-with-dashes-789"],
      ["Log_MixedCase_123"],
    ])("roundtrips id %s", (id) => {
      const result = decodeCursor(encodeCursor(TS, id));
      expect(result.id).toBe(id);
      expect(result.timestamp.toISOString()).toBe(TS.toISOString());
    });

    it("creates different cursors for different timestamps", () => {
      expect(encodeCursor(TS, "same_id")).not.toBe(
        encodeCursor(new Date("2024-01-15T10:31:00.000Z"), "same_id"),
      );
    });

    it("creates different cursors for different IDs", () => {
      expect(encodeCursor(TS, "log_123")).not.toBe(encodeCursor(TS, "log_456"));
    });

    const unencodable: Array<[string | number | Date | null | undefined, string]> = [
      [null, "Cannot encode cursor for log without timestamp"],
      [undefined, "Cannot encode cursor for log without timestamp"],
      [Number.NaN, "Cannot encode cursor for log without timestamp"],
      [new Date(Number.NaN), "Cannot encode cursor for log without timestamp"],
      [1.5, "micros must be a decimal integer"],
      [Number.POSITIVE_INFINITY, "micros must be a decimal integer"],
      ["not-a-number", "micros must be a decimal integer"],
    ];

    it.each(unencodable)("throws for unencodable micros %s", (value, message) => {
      expect(() => encodeCursor(value, "log_123")).toThrow(message);
    });
  });

  describe("decodeCursor", () => {
    it.each([
      ["not-valid-base64!@#$%", "Invalid cursor", "invalid base64url"],
      [
        Buffer.from("2024-01-15T10:30:00.000Zlog123").toString("base64url"),
        "Invalid cursor format",
        "missing separator",
      ],
      [Buffer.from("_log_123").toString("base64url"), "Invalid cursor format", "empty timestamp"],
      [
        Buffer.from("2024-01-15T10:30:00.000Z_").toString("base64url"),
        "Invalid cursor format",
        "empty id",
      ],
      [
        Buffer.from("not-a-date_log_123").toString("base64url"),
        "Invalid cursor format",
        "invalid timestamp",
      ],
    ])("throws on %s (%s)", (cursor, message) => {
      expect(() => decodeCursor(cursor)).toThrow(message);
    });
  });

  describe("roundtrip encode/decode", () => {
    it("roundtrips millisecond timestamps exactly", () => {
      const timestamp = new Date("2024-01-15T10:30:00.999Z");
      const result = decodeCursor(encodeCursor(timestamp, "log_999"));
      expect(result.timestamp.toISOString()).toBe(timestamp.toISOString());
      expect(result.id).toBe("log_999");
    });

    it("roundtrips microsecond-precision timestamps exactly", () => {
      const micros = 1767225600123456; // 2026-01-01T00:00:00.123456Z
      const result = decodeCursor(encodeCursor(micros, "log_123"));
      expect(result.micros).toBe(String(micros));
      expect(result.id).toBe("log_123");
      // Convenience timestamp is millisecond-truncated
      expect(result.timestamp.toISOString()).toBe("2026-01-01T00:00:00.123Z");
    });

    it("roundtrips far-future timestamps whose micros exceed Number.MAX_SAFE_INTEGER", () => {
      const micros = "32503680000000000"; // 3000-01-01T00:00:00.000000Z
      const result = decodeCursor(encodeCursor(micros, "log_future"));
      expect(result.micros).toBe(micros);
      expect(result.id).toBe("log_future");
      expect(result.timestamp.toISOString()).toBe("3000-01-01T00:00:00.000Z");
    });

    it("keeps every digit of micros that no JS number can represent", () => {
      const micros = "32503680000000000000";
      expect(decodeCursor(encodeCursor(micros, "log_far")).micros).toBe(micros);

      const odd = "32503680000000000001";
      expect(decodeCursor(encodeCursor(odd, "log_far")).micros).toBe(odd);
      expect(decodeCursor(encodeCursor(odd, "log_far")).micros).not.toBe(String(Number(odd)));
    });

    it("distinguishes adjacent far-future microseconds", () => {
      expect(encodeCursor("32503680000000001", "log_123")).not.toBe(
        encodeCursor("32503680000000000", "log_123"),
      );
    });

    it("roundtrips pre-1970 timestamps", () => {
      const micros = "-315619200000000"; // 1960-01-01T00:00:00.000000Z
      const result = decodeCursor(encodeCursor(micros, "log_past"));
      expect(result.micros).toBe(micros);
      expect(result.timestamp.toISOString()).toBe("1960-01-01T00:00:00.000Z");

      const fromDate = decodeCursor(encodeCursor(new Date("1960-01-01T00:00:00.000Z"), "log_past"));
      expect(fromDate.micros).toBe(micros);
    });

    it("roundtrips a pre-1970 microsecond that is not a whole millisecond", () => {
      const micros = "-1500001"; // 1969-12-31T23:59:58.499999Z
      const result = decodeCursor(encodeCursor(micros, "log_past_us"));
      expect(result.micros).toBe(micros);
      expect(result.timestamp.toISOString()).toBe("1969-12-31T23:59:58.499Z");
    });

    it("decodes number- and Date-encoded cursors to the same value", () => {
      const micros = TS.getTime() * 1000;
      const fromMicros = decodeCursor(encodeCursor(micros, "log_123"));
      const fromDate = decodeCursor(encodeCursor(TS, "log_123"));
      expect(fromMicros.micros).toBe(String(micros));
      expect(fromMicros.micros).toBe(fromDate.micros);
      expect(fromMicros.timestamp.toISOString()).toBe(fromDate.timestamp.toISOString());
    });
  });
});
