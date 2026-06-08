import { describe, expect, it } from "vite-plus/test";
import { decodeCursor, encodeCursor } from "./cursor";

describe("cursor utilities", () => {
  describe("encodeCursor", () => {
    it("creates valid base64url string", () => {
      const timestamp = new Date("2024-01-15T10:30:00.000Z");
      const id = "log_123";

      const cursor = encodeCursor(timestamp, id);

      // Should be a non-empty string
      expect(cursor).toBeTruthy();
      expect(typeof cursor).toBe("string");

      // Should be valid base64url (no +, /, or = characters)
      expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it("handles IDs with underscores", () => {
      const timestamp = new Date("2024-01-15T10:30:00.000Z");
      const id = "log_with_underscores_123";

      const cursor = encodeCursor(timestamp, id);

      expect(cursor).toBeTruthy();
      expect(typeof cursor).toBe("string");
    });

    it("creates different cursors for different timestamps", () => {
      const id = "same_id";
      const timestamp1 = new Date("2024-01-15T10:30:00.000Z");
      const timestamp2 = new Date("2024-01-15T10:31:00.000Z");

      const cursor1 = encodeCursor(timestamp1, id);
      const cursor2 = encodeCursor(timestamp2, id);

      expect(cursor1).not.toBe(cursor2);
    });

    it("creates different cursors for different IDs", () => {
      const timestamp = new Date("2024-01-15T10:30:00.000Z");
      const id1 = "log_123";
      const id2 = "log_456";

      const cursor1 = encodeCursor(timestamp, id1);
      const cursor2 = encodeCursor(timestamp, id2);

      expect(cursor1).not.toBe(cursor2);
    });
  });

  describe("decodeCursor", () => {
    it("parses cursor correctly", () => {
      const timestamp = new Date("2024-01-15T10:30:00.000Z");
      const id = "log_123";
      const cursor = encodeCursor(timestamp, id);

      const result = decodeCursor(cursor);

      expect(result.timestamp.toISOString()).toBe(timestamp.toISOString());
      expect(result.id).toBe(id);
    });

    it("handles IDs with underscores", () => {
      const timestamp = new Date("2024-01-15T10:30:00.000Z");
      const id = "log_with_underscores_123";
      const cursor = encodeCursor(timestamp, id);

      const result = decodeCursor(cursor);

      expect(result.timestamp.toISOString()).toBe(timestamp.toISOString());
      expect(result.id).toBe(id);
    });

    it("throws on invalid base64url", () => {
      expect(() => decodeCursor("not-valid-base64!@#$%")).toThrow("Invalid cursor");
    });

    it("throws on missing separator", () => {
      // Create a base64 string without underscore separator
      const invalid = Buffer.from("2024-01-15T10:30:00.000Zlog123").toString("base64url");
      expect(() => decodeCursor(invalid)).toThrow("Invalid cursor format");
    });

    it("throws on empty timestamp", () => {
      const invalid = Buffer.from("_log_123").toString("base64url");
      expect(() => decodeCursor(invalid)).toThrow("Invalid cursor format");
    });

    it("throws on empty id", () => {
      const invalid = Buffer.from("2024-01-15T10:30:00.000Z_").toString("base64url");
      expect(() => decodeCursor(invalid)).toThrow("Invalid cursor format");
    });

    it("throws on invalid timestamp", () => {
      const invalid = Buffer.from("not-a-date_log_123").toString("base64url");
      expect(() => decodeCursor(invalid)).toThrow("Invalid cursor format");
    });
  });

  describe("roundtrip encode/decode", () => {
    it("successfully roundtrips timestamp and id", () => {
      const timestamp = new Date("2024-01-15T10:30:00.123Z");
      const id = "log_abc_123";

      const cursor = encodeCursor(timestamp, id);
      const result = decodeCursor(cursor);

      expect(result.timestamp.toISOString()).toBe(timestamp.toISOString());
      expect(result.id).toBe(id);
    });

    it("handles timestamps with milliseconds", () => {
      const timestamp = new Date("2024-01-15T10:30:00.999Z");
      const id = "log_999";

      const cursor = encodeCursor(timestamp, id);
      const result = decodeCursor(cursor);

      expect(result.timestamp.toISOString()).toBe(timestamp.toISOString());
      expect(result.id).toBe(id);
    });

    it("handles various ID formats", () => {
      const timestamp = new Date("2024-01-15T10:30:00.000Z");
      const testIds = [
        "simple",
        "with_underscores",
        "with-dashes",
        "MixedCase123",
        "log_2024_01_15_abc",
      ];

      for (const id of testIds) {
        const cursor = encodeCursor(timestamp, id);
        const result = decodeCursor(cursor);

        expect(result.id).toBe(id);
        expect(result.timestamp.toISOString()).toBe(timestamp.toISOString());
      }
    });
  });
});
