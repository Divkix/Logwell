import { describe, expect, it } from "vite-plus/test";
import { LogwellError } from "../../src/errors";

describe("LogwellError", () => {
  describe("constructor", () => {
    it("creates error with message, code, statusCode, and retryable", () => {
      const error = new LogwellError("Server error", "SERVER_ERROR", 500, true);

      expect(error.message).toBe("Server error");
      expect(error.code).toBe("SERVER_ERROR");
      expect(error.name).toBe("LogwellError");
      expect(error.statusCode).toBe(500);
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

  describe("serialization", () => {
    it("can be converted to JSON", () => {
      const error = new LogwellError("Test error", "SERVER_ERROR", 500, true);
      const json = JSON.stringify(error);
      const parsed = JSON.parse(json);

      expect(parsed.code).toBe("SERVER_ERROR");
      expect(parsed.statusCode).toBe(500);
      expect(parsed.retryable).toBe(true);
    });
  });
});
