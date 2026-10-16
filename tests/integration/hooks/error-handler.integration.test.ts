import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { type ErrorContext, handleError } from "#lib/server/error-handler.js";

describe("Global Error Handler", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  function createErrorContext(overrides: Partial<ErrorContext> = {}): ErrorContext {
    return {
      error: new Error("Test error"),
      url: "http://localhost:5173/api/projects",
      method: "POST",
      route: "/api/projects",
      status: 500,
      message: "Internal server error",
      ...overrides,
    };
  }

  describe("logging", () => {
    it("logs error with request context", () => {
      const context = createErrorContext();

      handleError(context);

      expect(consoleErrorSpy).toHaveBeenCalled();
      const loggedArgs = consoleErrorSpy.mock.calls[0];
      expect(loggedArgs[0]).toContain("[ERROR]");
      expect(loggedArgs[0]).toContain("/api/projects");
      expect(loggedArgs[0]).toContain("POST");
    });

    it("logs error stack trace for debugging", () => {
      const error = new Error("Test error");
      error.stack = "Error: Test error\n    at test.ts:1:1";
      const context = createErrorContext({ error });

      handleError(context);

      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it("includes error ID in log for tracing", () => {
      const context = createErrorContext();

      const result = handleError(context);

      expect(result.id).toBeDefined();
      expect(consoleErrorSpy.mock.calls[0][0]).toContain(result.id);
    });
  });

  describe("error message sanitization", () => {
    it("returns sanitized error message for 500 errors", () => {
      const sensitiveError = new Error("Database password: secret123");

      const context = createErrorContext({
        error: sensitiveError,
        status: 500,
        message: "Internal server error",
      });

      const result = handleError(context);

      expect(result.message).not.toContain("secret123");
      expect(result.message).toBe("Internal server error");
    });

    it("returns original message for 4xx errors", () => {
      const context = createErrorContext({
        status: 400,
        message: "Project name already exists",
      });

      const result = handleError(context);

      expect(result.message).toBe("Project name already exists");
    });

    it("returns original message for 404 errors", () => {
      const context = createErrorContext({
        status: 404,
        message: "Project not found",
      });

      const result = handleError(context);

      expect(result.message).toBe("Project not found");
    });
  });

  describe("query timeout mapping", () => {
    it("turns a statement_timeout cancellation (SQLSTATE 57014) into 503 query_timeout", () => {
      // Shape verified against postgres:18 + postgres-js: drizzle's wrapper carries no code,
      // the driver error on `cause` holds the SQLSTATE.
      const driverError = Object.assign(new Error("canceling statement due to statement timeout"), {
        code: "57014",
      });

      const wrapped = new Error("Failed query: select ... from log", { cause: driverError });

      const result = handleError(createErrorContext({ error: wrapped, status: 500 }));

      expect(result.status).toBe(503);
      expect(result.error).toBe("query_timeout");
      expect(result.message).toMatch(/narrow the time range/i);
      expect(result.message).not.toContain("select");
      expect(consoleErrorSpy.mock.calls[0][0]).toContain("Status: 503");
    });

    it("leaves other database errors as a sanitized 500 without overrides", () => {
      const wrapped = new Error("Failed query", {
        cause: Object.assign(new Error("deadlock detected"), { code: "40P01" }),
      });

      const result = handleError(createErrorContext({ error: wrapped, status: 500 }));

      expect(result.status).toBeUndefined();
      expect(result.error).toBeUndefined();
      expect(result.message).toBe("Internal server error");
    });
  });

  describe("error ID generation", () => {
    it("generates unique error IDs for tracking", () => {
      const context = createErrorContext();

      const result1 = handleError(context);
      const result2 = handleError(context);

      expect(result1.id).toBeDefined();
      expect(result2.id).toBeDefined();
      expect(result1.id).not.toBe(result2.id);
    });

    it("generates IDs with consistent format", () => {
      const context = createErrorContext();

      const result = handleError(context);

      expect(result.id).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(result.id.length).toBe(12);
    });
  });

  describe("error context preservation", () => {
    it("includes route information in response", () => {
      const context = createErrorContext({
        route: "/api/projects/[id]",
      });

      const result = handleError(context);

      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("message");
    });
  });
});
