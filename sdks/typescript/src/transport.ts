import { LogwellError } from './errors';
import type { IngestResponse, LogEntry } from './types';

/**
 * Transport configuration
 */
export interface TransportConfig {
  endpoint: string;
  apiKey: string;
  maxRetries: number;
  timeout?: number;
}

/**
 * Delay helper with exponential backoff
 */
function delay(attempt: number, baseDelay = 100): Promise<void> {
  const ms = Math.min(baseDelay * 2 ** attempt, 10000);
  const jitter = Math.random() * ms * 0.3;
  return new Promise((resolve) => setTimeout(resolve, ms + jitter));
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse a `Retry-After` header into milliseconds.
 *
 * Supports both HTTP formats:
 * - delta-seconds (e.g. "120") — multiplied by 1000
 * - HTTP-date (e.g. "Wed, 21 Oct 2015 07:28:00 GMT") — the non-negative
 *   difference from the current time
 *
 * @returns delay in milliseconds, or undefined if the header is absent/invalid
 */
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) {
    return undefined;
  }
  // delta-seconds form
  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  // HTTP-date form
  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return undefined;
}

/**
 * HTTP transport for sending logs to Logwell server
 *
 * Features:
 * - Automatic retry with exponential backoff
 * - Error classification with retryable flag
 * - Proper error handling for all HTTP status codes
 */
export class HttpTransport {
  private readonly ingestUrl: string;

  constructor(private config: TransportConfig) {
    const cleanEndpoint = config.endpoint.replace(/\/$/, '');
    this.ingestUrl = `${cleanEndpoint}/v1/ingest`;
  }

  /**
   * Send logs to the Logwell server
   *
   * @param logs - Array of log entries to send
   * @returns Response with accepted/rejected counts
   * @throws LogwellError on failure after all retries
   */
  async send(logs: LogEntry[]): Promise<IngestResponse> {
    let lastError: LogwellError = new LogwellError(
      'Max retries exceeded',
      'NETWORK_ERROR',
      undefined,
      true,
    );

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await this.doRequest(logs);
      } catch (error) {
        if (error instanceof LogwellError) {
          lastError = error;
        } else {
          lastError = new LogwellError(
            `Unexpected error: ${(error as Error).message}`,
            'NETWORK_ERROR',
            undefined,
            true,
          );
        }

        // Don't retry non-retryable errors
        if (!lastError.retryable) {
          throw lastError;
        }

        // Don't delay after the last attempt
        if (attempt < this.config.maxRetries) {
          if (lastError.retryAfterMs !== undefined) {
            // Honor Retry-After but cap it to the exponential backoff ceiling
            const backoffMs = Math.min(100 * 2 ** attempt, 10000);
            await sleep(Math.min(lastError.retryAfterMs, backoffMs));
          } else {
            await delay(attempt);
          }
        }
      }
    }

    throw lastError;
  }

  private async doRequest(logs: LogEntry[]): Promise<IngestResponse> {
    let response: Response;

    try {
      response = await fetch(this.ingestUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(logs),
        signal: AbortSignal.timeout(this.config.timeout ?? 30000),
        keepalive: true,
      });
    } catch (error) {
      // Timeout error (AbortError or TimeoutError)
      if (
        error instanceof Error &&
        (error.name === 'AbortError' || error.name === 'TimeoutError')
      ) {
        throw new LogwellError('Request timed out', 'NETWORK_ERROR', undefined, true);
      }
      // Network error (fetch failed)
      throw new LogwellError(
        `Network error: ${(error as Error).message}`,
        'NETWORK_ERROR',
        undefined,
        true,
      );
    }

    // Handle error responses
    if (!response.ok) {
      const errorBody = await this.tryParseError(response);
      throw this.createErrorWithRetryAfter(response, errorBody);
    }

    // Parse successful response
    return (await response.json()) as IngestResponse;
  }

  private async tryParseError(response: Response): Promise<string> {
    try {
      const body = await response.json();
      return body.message || body.error || 'Unknown error';
    } catch {
      return `HTTP ${response.status}`;
    }
  }

  private createErrorWithRetryAfter(response: Response, message: string): LogwellError {
    const { status } = response;
    if (status === 429) {
      const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'));
      return new LogwellError(
        `Rate limited: ${message}`,
        'RATE_LIMITED',
        status,
        true,
        retryAfterMs,
      );
    }
    return this.createError(status, message);
  }

  private createError(status: number, message: string): LogwellError {
    switch (status) {
      case 401:
        return new LogwellError(`Unauthorized: ${message}`, 'UNAUTHORIZED', status, false);
      case 400:
        return new LogwellError(`Validation error: ${message}`, 'VALIDATION_ERROR', status, false);
      case 429:
        return new LogwellError(`Rate limited: ${message}`, 'RATE_LIMITED', status, true);
      default:
        if (status >= 500) {
          return new LogwellError(`Server error: ${message}`, 'SERVER_ERROR', status, true);
        }
        return new LogwellError(`HTTP error ${status}: ${message}`, 'SERVER_ERROR', status, false);
    }
  }
}
