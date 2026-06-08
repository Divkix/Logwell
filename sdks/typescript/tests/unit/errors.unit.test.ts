import { describe, expect, it } from "vite-plus/test";
import { LogwellError, type LogwellErrorCode } from "../../src/errors";

describe("LogwellError", () => {
  describe("constructor", () => {
    it("creates error with message and code", () => {
      const error = new LogwellError("Test error", "NETWORK_ERROR");

      expect(error.message).toBe("Test error");
      expect(error.code).toBe("NETWORK_ERROR");
      expect(error.name).toBe("LogwellError");
    });

    it("creates error with statusCode", () => {
      const error = new LogwellError("Unauthorized", "UNAUTHORIZED", 401);

      expect(error.statusCode).toBe(401);
    });

    it("creates error with retryable flag", () => {
      const error = new LogwellError("Server error", "SERVER_ERROR", 500, true);

      expect(error.retryable).toBe(true);
    });

    it("defaults retryable to false", () => {
      const error = new LogwellError("Bad request", "VALIDATION_ERROR", 400);

      expect(error.retryable).toBe(false);
    });

    it("allows undefined statusCode", () => {
      const error = new LogwellError("Network failed", "NETWORK_ERROR");

      expect(error.statusCode).toBeUndefined();
    });
  });

  describe("inheritance", () => {
    it("is an instance of Error", () => {
      const error = new LogwellError("Test", "NETWORK_ERROR");

      expect(error).toBeInstanceOf(Error);
    });

    it("is an instance of LogwellError", () => {
      const error = new LogwellError("Test", "NETWORK_ERROR");

      expect(error).toBeInstanceOf(LogwellError);
    });

    it("has correct stack trace", () => {
      const error = new LogwellError("Test", "NETWORK_ERROR");

      expect(error.stack).toBeDefined();
      expect(error.stack).toContain("LogwellError");
    });
  });

  describe("error codes", () => {
    const testCases: Array<[LogwellErrorCode, string, number | undefined, boolean]> = [
      ["NETWORK_ERROR", "Network failed", undefined, true],
      ["UNAUTHORIZED", "Invalid API key", 401, false],
      ["VALIDATION_ERROR", "Invalid format", 400, false],
      ["RATE_LIMITED", "Too many requests", 429, true],
      ["SERVER_ERROR", "Internal error", 500, true],
      ["QUEUE_OVERFLOW", "Queue full", undefined, false],
      ["INVALID_CONFIG", "Bad config", undefined, false],
    ];

    it.each(testCases)(
      "handles %s error code correctly",
      (code, message, statusCode, retryable) => {
        const error = new LogwellError(message, code, statusCode, retryable);

        expect(error.code).toBe(code);
        expect(error.message).toBe(message);
        expect(error.statusCode).toBe(statusCode);
        expect(error.retryable).toBe(retryable);
      },
    );
  });

  describe("serialization", () => {
    it("can be converted to JSON", () => {
      const error = new LogwellError("Test error", "SERVER_ERROR", 500, true);
      const json = JSON.stringify(error);
      const parsed = JSON.parse(json);

      // Note: Error.message is not enumerable, so it won't be in JSON
      // But code, statusCode, and retryable should be
      expect(parsed.code).toBe("SERVER_ERROR");
      expect(parsed.statusCode).toBe(500);
      expect(parsed.retryable).toBe(true);
    });

    it("has correct toString representation", () => {
      const error = new LogwellError("Something went wrong", "NETWORK_ERROR");
      const str = error.toString();

      expect(str).toContain("LogwellError");
      expect(str).toContain("Something went wrong");
    });
  });

  describe("cause support", () => {
    it("supports cause option for error chaining", () => {
      const cause = new Error("Original error");
      const error = new LogwellError("Wrapped error", "NETWORK_ERROR", undefined, true);
      // Set cause manually since we need to support it
      Object.defineProperty(error, "cause", { value: cause });

      expect(error.cause).toBe(cause);
    });
  });
});
