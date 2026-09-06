import { describe, expect, it } from "vite-plus/test";
import { parseSimpleIngestRequest, SimpleIngestError } from "./simple-ingest";

describe("parseSimpleIngestRequest", () => {
  const validEntry = { level: "info", message: "test message" };

  describe("input validation", () => {
    it.each([[null], [undefined]])("throws SimpleIngestError on %s body", (body) => {
      expect(() => parseSimpleIngestRequest(body)).toThrow(SimpleIngestError);
      expect(() => parseSimpleIngestRequest(body)).toThrow("Request body cannot be empty");
    });

    it("throws SimpleIngestError on empty array", () => {
      expect(() => parseSimpleIngestRequest([])).toThrow(SimpleIngestError);
      expect(() => parseSimpleIngestRequest([])).toThrow("Request body cannot be an empty array");
    });

    it("accepts single object and wraps in array", () => {
      const result = parseSimpleIngestRequest(validEntry);
      expect(result.accepted).toBe(1);
      expect(result.records).toHaveLength(1);
    });

    it("accepts array of objects", () => {
      const result = parseSimpleIngestRequest([validEntry, validEntry]);
      expect(result.accepted).toBe(2);
      expect(result.records).toHaveLength(2);
    });
  });

  describe("required fields", () => {
    it.each([
      [{ message: "test" }, "missing required field 'level'", "missing level"],
      [{ level: "invalid", message: "test" }, "invalid level 'invalid'", "invalid level"],
      [{ level: "info" }, "missing required field 'message'", "missing message"],
      [{ level: "info", message: 123 }, "message must be a string", "non-string message"],
      [{ level: "info", message: "   " }, "message cannot be empty", "empty message"],
      [[null], "must be an object", "null entry"],
      [["not an object"], "must be an object", "string entry"],
      [[123], "must be an object", "number entry"],
    ] as [unknown, string, string][])("rejects %s (%s)", (input, message) => {
      const result = parseSimpleIngestRequest(input);
      expect(result.rejected).toBe(1);
      expect(result.errors[0]!).toContain(message);
    });
  });

  describe("valid log levels", () => {
    it.each(["debug", "info", "warn", "error", "fatal"] as const)('accepts level "%s"', (level) => {
      const result = parseSimpleIngestRequest({ level, message: "test" });
      expect(result.accepted).toBe(1);
      expect(result.records[0]!.level).toBe(level);
    });
  });

  describe("optional fields", () => {
    describe("timestamp", () => {
      it("parses valid ISO8601 timestamp", () => {
        const timestamp = "2024-01-15T10:30:00Z";
        const result = parseSimpleIngestRequest({ ...validEntry, timestamp });
        expect(result.records[0]!.timestamp).toEqual(new Date(timestamp));
      });

      it.each([["invalid"], [12345], [undefined]])(
        "falls back to now for timestamp %s",
        (timestamp) => {
          const before = Date.now();
          const result = parseSimpleIngestRequest({ ...validEntry, timestamp });
          const after = Date.now();
          expect(result.records[0]!.timestamp.getTime()).toBeGreaterThanOrEqual(before);
          expect(result.records[0]!.timestamp.getTime()).toBeLessThanOrEqual(after);
        },
      );
    });

    describe("service", () => {
      it("parses service name into resourceAttributes", () => {
        const result = parseSimpleIngestRequest({ ...validEntry, service: "my-app" });
        expect(result.records[0]!.resourceAttributes).toEqual({ "service.name": "my-app" });
      });

      it.each([[undefined], [123]])("returns null resourceAttributes for service %s", (service) => {
        const result = parseSimpleIngestRequest({ ...validEntry, service });
        expect(result.records[0]!.resourceAttributes).toBeNull();
      });
    });

    describe("metadata", () => {
      it("parses metadata object", () => {
        const metadata = { foo: "bar", nested: { a: 1 } };
        const result = parseSimpleIngestRequest({ ...validEntry, metadata });
        expect(result.records[0]!.metadata).toEqual(metadata);
      });

      it.each([[undefined], ["string"], [null], [{}]])(
        "returns null metadata for %s",
        (metadata) => {
          const result = parseSimpleIngestRequest({ ...validEntry, metadata });
          expect(result.records[0]!.metadata).toBeNull();
        },
      );
    });
  });

  describe("source location fields", () => {
    describe("sourceFile", () => {
      it("parses valid sourceFile", () => {
        const result = parseSimpleIngestRequest({ ...validEntry, sourceFile: "/app/index.ts" });
        expect(result.records[0]!.sourceFile).toBe("/app/index.ts");
      });

      it.each([[undefined], [123], [null]])("returns null sourceFile for %s", (sourceFile) => {
        const result = parseSimpleIngestRequest({ ...validEntry, sourceFile });
        expect(result.records[0]!.sourceFile).toBeNull();
      });
    });

    describe("lineNumber", () => {
      it("parses valid lineNumber", () => {
        const result = parseSimpleIngestRequest({ ...validEntry, lineNumber: 42 });
        expect(result.records[0]!.lineNumber).toBe(42);
      });

      it.each([[undefined], ["42"], [0], [-5], [null]])(
        "returns null lineNumber for %s",
        (lineNumber) => {
          const result = parseSimpleIngestRequest({ ...validEntry, lineNumber });
          expect(result.records[0]!.lineNumber).toBeNull();
        },
      );
    });

    describe("combined", () => {
      it("parses both sourceFile and lineNumber together", () => {
        const result = parseSimpleIngestRequest({
          ...validEntry,
          sourceFile: "/app/utils.ts",
          lineNumber: 100,
        });
        expect(result.records[0]!.sourceFile).toBe("/app/utils.ts");
        expect(result.records[0]!.lineNumber).toBe(100);
      });
    });
  });

  describe("metadata extraction", () => {
    it.each([
      [{ "request.id": "req-123" }, "requestId", "req-123", "OTLP request key"],
      [{ "enduser.id": "user-456" }, "userId", "user-456", "OTLP user key"],
      [{ "client.address": "192.168.1.1" }, "ipAddress", "192.168.1.1", "OTLP ip key"],
      [{ request_id: "req-789" }, "requestId", "req-789", "fallback request key"],
      [{ user_id: "user-999" }, "userId", "user-999", "fallback user key"],
      [{ ip_address: "10.0.0.1" }, "ipAddress", "10.0.0.1", "fallback ip key"],
    ] as [Record<string, string>, string, string, string][])(
      "extracts %s from metadata (%s)",
      (metadata, field, expected) => {
        const result = parseSimpleIngestRequest({ ...validEntry, metadata });
        expect(result.records[0]![field as "requestId"]).toBe(expected);
      },
    );

    it("returns null for missing metadata fields", () => {
      const result = parseSimpleIngestRequest(validEntry);
      expect(result.records[0]!.requestId).toBeNull();
      expect(result.records[0]!.userId).toBeNull();
      expect(result.records[0]!.ipAddress).toBeNull();
    });

    it("returns null for empty metadata", () => {
      const result = parseSimpleIngestRequest({
        ...validEntry,
        metadata: {},
      });
      expect(result.records[0]!.requestId).toBeNull();
      expect(result.records[0]!.userId).toBeNull();
      expect(result.records[0]!.ipAddress).toBeNull();
    });
  });

  describe("batch processing", () => {
    it("correctly counts accepted and rejected", () => {
      const entries = [
        validEntry,
        { level: "invalid", message: "bad" },
        { level: "debug", message: "good" },
        { message: "missing level" },
      ];
      const result = parseSimpleIngestRequest(entries);
      expect(result.accepted).toBe(2);
      expect(result.rejected).toBe(2);
      expect(result.accepted + result.rejected).toBe(entries.length);
    });

    it("collects all errors", () => {
      const entries = [
        { level: "invalid", message: "bad" },
        { message: "missing level" },
        { level: "info" },
      ];
      const result = parseSimpleIngestRequest(entries);
      expect(result.errors).toHaveLength(3);
    });

    it("processes valid entries despite errors in batch", () => {
      const entries = [
        validEntry,
        { level: "invalid", message: "bad" },
        { level: "debug", message: "good" },
      ];
      const result = parseSimpleIngestRequest(entries);
      expect(result.records).toHaveLength(2);
      expect(result.records[0]!.message).toBe("test message");
      expect(result.records[1]!.message).toBe("good");
    });

    it("includes index in error messages", () => {
      const entries = [validEntry, validEntry, { level: "invalid", message: "bad" }];
      const result = parseSimpleIngestRequest(entries);
      expect(result.errors[0]!).toContain("index 2");
    });
  });
});

describe("SimpleIngestError", () => {
  it("carries its name, message, and prototype chain", () => {
    const error = new SimpleIngestError("test message");
    expect(error.name).toBe("SimpleIngestError");
    expect(error.message).toBe("test message");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(SimpleIngestError);
  });
});
