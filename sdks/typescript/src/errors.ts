/**
 * Error codes for Logwell SDK errors
 */
export type LogwellErrorCode =
  | "NETWORK_ERROR"
  | "UNAUTHORIZED"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "QUEUE_OVERFLOW"
  | "INVALID_CONFIG";

/**
 * Custom error class for Logwell SDK errors
 *
 * @example
 * ```ts
 * throw new LogwellError('Invalid API key', 'UNAUTHORIZED', 401, false);
 * ```
 */
export class LogwellError extends Error {
  /**
   * Creates a new LogwellError
   *
   * @param message - Human-readable error message
   * @param code - Error code for programmatic handling
   * @param statusCode - HTTP status code if applicable
   * @param retryable - Whether the operation can be retried
   */
  constructor(
    message: string,
    public readonly code: LogwellErrorCode,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "LogwellError";

    // Maintains proper stack trace for where our error was thrown (V8 only)
    // Use type assertion to avoid global augmentation (required for JSR compatibility)
    const ErrorWithCapture = Error as unknown as {
      captureStackTrace?: (target: object, ctor?: NewableFunction) => void;
    };
    ErrorWithCapture.captureStackTrace?.(this, LogwellError);
  }
}
