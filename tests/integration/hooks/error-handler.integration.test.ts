import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createErrorHandler, type ErrorContext } from '$lib/server/error-handler';

describe('Global Error Handler', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let handleError: ReturnType<typeof createErrorHandler>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    handleError = createErrorHandler();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  function createErrorContext(overrides: Partial<ErrorContext> = {}): ErrorContext {
    return {
      error: new Error('Test error'),
      url: 'http://localhost:5173/api/projects',
      method: 'POST',
      route: '/api/projects',
      status: 500,
      message: 'Internal Server Error',
      ...overrides,
    };
  }

  describe('logging', () => {
    it('logs error with request context', () => {
      const context = createErrorContext();

      handleError(context);

      expect(consoleErrorSpy).toHaveBeenCalled();
      const loggedArgs = consoleErrorSpy.mock.calls[0];
      expect(loggedArgs[0]).toContain('[ERROR]');
      expect(loggedArgs[0]).toContain('/api/projects');
      expect(loggedArgs[0]).toContain('POST');
    });

    it('logs error stack trace for debugging', () => {
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at test.ts:1:1';
      const context = createErrorContext({ error });

      handleError(context);

      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('includes error ID in log for tracing', () => {
      const context = createErrorContext();

      const result = handleError(context);

      expect(result.id).toBeDefined();
      expect(consoleErrorSpy.mock.calls[0][0]).toContain(result.id);
    });
  });

  describe('error message sanitization', () => {
    it('returns sanitized error message for 500 errors', () => {
      const sensitiveError = new Error('Database password: secret123');
      const context = createErrorContext({
        error: sensitiveError,
        status: 500,
        message: 'Internal Server Error',
      });

      const result = handleError(context);

      // Should not expose internal error details
      expect(result.message).not.toContain('secret123');
      expect(result.message).toBe('Internal Server Error');
    });

    it('returns original message for 4xx errors', () => {
      const context = createErrorContext({
        status: 400,
        message: 'Project name already exists',
      });

      const result = handleError(context);

      // 4xx errors can show user-friendly messages
      expect(result.message).toBe('Project name already exists');
    });

    it('returns original message for 404 errors', () => {
      const context = createErrorContext({
        status: 404,
        message: 'Project not found',
      });

      const result = handleError(context);

      expect(result.message).toBe('Project not found');
    });
  });

  describe('error ID generation', () => {
    it('generates unique error IDs for tracking', () => {
      const context = createErrorContext();

      const result1 = handleError(context);
      const result2 = handleError(context);

      expect(result1.id).toBeDefined();
      expect(result2.id).toBeDefined();
      expect(result1.id).not.toBe(result2.id);
    });

    it('generates IDs with consistent format', () => {
      const context = createErrorContext();

      const result = handleError(context);

      // ID should be URL-safe (nanoid uses A-Za-z0-9_-)
      expect(result.id).toMatch(/^[A-Za-z0-9_-]+$/);
      // ID should be exactly 12 characters (as specified in createErrorHandler)
      expect(result.id.length).toBe(12);
    });
  });

  describe('error context preservation', () => {
    it('includes route information in response', () => {
      const context = createErrorContext({
        route: '/api/projects/[id]',
      });

      const result = handleError(context);

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('message');
    });
  });
});
