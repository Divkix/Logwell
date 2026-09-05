import { LogwellError } from "./errors";
import type { IngestResponse, LogEntry } from "./types";

/**
 * Transport configuration
 */
export interface TransportConfig {
  endpoint: string;
  apiKey: string;
  maxRetries: number;
  timeout?: number;
}

const MAX_BACKOFF_MS = 10000;

function backoffMs(attempt: number, baseDelay = 100): number {
  return Math.min(baseDelay * 2 ** attempt, MAX_BACKOFF_MS);
}

function delay(attempt: number, baseDelay = 100): Promise<void> {
  const ms = backoffMs(attempt, baseDelay);
  const jitter = Math.random() * ms * 0.3;
  return new Promise((resolve) => setTimeout(resolve, ms + jitter));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) {
    return undefined;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
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
    const cleanEndpoint = config.endpoint.replace(/\/$/, "");
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
      "Max retries exceeded",
      "NETWORK_ERROR",
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
            "NETWORK_ERROR",
            undefined,
            true,
          );
        }

        if (!lastError.retryable) {
          throw lastError;
        }

        if (attempt < this.config.maxRetries) {
          if (lastError.retryAfterMs !== undefined) {
            await sleep(Math.min(lastError.retryAfterMs, backoffMs(attempt)));
          } else {
            await delay(attempt);
          }
        }
      }
    }

    throw lastError;
  }

  private async doRequest(logs: LogEntry[]): Promise<IngestResponse> {
    let body: string;
    try {
      body = JSON.stringify(logs);
    } catch (error) {
      throw new LogwellError(
        `Failed to serialize payload: ${(error as Error).message}`,
        "VALIDATION_ERROR",
        400,
        false,
      );
    }
    // The Fetch spec caps keepalive request bodies at 64 KiB; enabling it for
    // larger payloads makes the request fail outright in browsers and undici.
    // Only opt in under that limit so large batches still send reliably.
    const useKeepalive = new TextEncoder().encode(body).length < 60_000;

    let response: Response;

    try {
      response = await fetch(this.ingestUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body,
        signal: AbortSignal.timeout(this.config.timeout ?? 30000),
        keepalive: useKeepalive,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError")
      ) {
        throw new LogwellError("Request timed out", "NETWORK_ERROR", undefined, true);
      }
      throw new LogwellError(
        `Network error: ${(error as Error).message}`,
        "NETWORK_ERROR",
        undefined,
        true,
      );
    }

    if (!response.ok) {
      const errorBody = await this.tryParseError(response);
      throw this.createErrorWithRetryAfter(response, errorBody);
    }

    return (await response.json()) as IngestResponse;
  }

  private async tryParseError(response: Response): Promise<string> {
    try {
      const body = await response.json();
      return body.message || body.error || "Unknown error";
    } catch {
      return `HTTP ${response.status}`;
    }
  }

  private createErrorWithRetryAfter(response: Response, message: string): LogwellError {
    const { status } = response;
    if (status === 429) {
      const retryAfterMs = parseRetryAfter(response.headers.get("Retry-After"));
      return new LogwellError(
        `Rate limited: ${message}`,
        "RATE_LIMITED",
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
        return new LogwellError(`Unauthorized: ${message}`, "UNAUTHORIZED", status, false);
      case 400:
        return new LogwellError(`Validation error: ${message}`, "VALIDATION_ERROR", status, false);
      default:
        if (status >= 500) {
          return new LogwellError(`Server error: ${message}`, "SERVER_ERROR", status, true);
        }
        if (status >= 400) {
          return new LogwellError(
            `Validation error: ${message}`,
            "VALIDATION_ERROR",
            status,
            false,
          );
        }
        return new LogwellError(`HTTP error ${status}: ${message}`, "SERVER_ERROR", status, false);
    }
  }
}
