import { validateConfig } from './config';
import { BatchQueue, type QueueConfig } from './queue';
import { captureSourceLocation } from './source-location';
import { HttpTransport } from './transport';
import type { IngestResponse, LogEntry, LogwellConfig } from './types';

/**
 * Child logger options
 */
export interface ChildLoggerOptions {
  service?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Internal resolved config with all defaults applied
 */
interface ResolvedConfig {
  apiKey: string;
  endpoint: string;
  service?: string;
  batchSize: number;
  flushInterval: number;
  maxQueueSize: number;
  maxRetries: number;
  captureSourceLocation: boolean;
  onError?: (error: Error) => void;
  onFlush?: (count: number) => void;
}

/**
 * Asserts that config has all required fields after validation
 */
function asResolvedConfig(config: LogwellConfig): ResolvedConfig {
  return config as ResolvedConfig;
}

/**
 * Main Logwell client class
 *
 * Provides methods for logging at different levels with automatic
 * batching, retry, and queue management.
 *
 * @example
 * ```ts
 * const logger = new Logwell({
 *   apiKey: 'lw_xxx',
 *   endpoint: 'https://logs.example.com',
 *   service: 'my-app',
 * });
 *
 * logger.info('User logged in', { userId: '123' });
 * await logger.shutdown();
 * ```
 */
export class Logwell {
  private readonly config: ResolvedConfig;
  private readonly queue: BatchQueue;
  private readonly transport: HttpTransport;
  private readonly parentMetadata?: Record<string, unknown>;
  private stopped = false;

  constructor(config: LogwellConfig);
  constructor(config: LogwellConfig, queue: BatchQueue, parentMetadata?: Record<string, unknown>);
  constructor(
    config: LogwellConfig,
    existingQueue?: BatchQueue,
    parentMetadata?: Record<string, unknown>,
  ) {
    // Validate and apply defaults
    this.config = asResolvedConfig(validateConfig(config));
    this.parentMetadata = parentMetadata;

    // Create transport
    this.transport = new HttpTransport({
      endpoint: this.config.endpoint,
      apiKey: this.config.apiKey,
      maxRetries: this.config.maxRetries,
    });

    // Use existing queue (for child loggers) or create new one
    if (existingQueue) {
      this.queue = existingQueue;
    } else {
      const queueConfig: QueueConfig = {
        batchSize: this.config.batchSize,
        flushInterval: this.config.flushInterval,
        maxQueueSize: this.config.maxQueueSize,
        onError: this.config.onError,
        onFlush: this.config.onFlush,
      };
      this.queue = new BatchQueue((logs) => this.transport.send(logs), queueConfig);
    }
  }

  /**
   * Current number of logs waiting in the queue
   */
  get queueSize(): number {
    return this.queue.size;
  }

  /**
   * Internal log method with source location capture.
   * @param entry - The log entry
   * @param skipFrames - Number of frames to skip for source location (2 for public methods)
   */
  private _addLog(entry: LogEntry, skipFrames: number): void {
    if (this.stopped) return;

    let sourceFile: string | undefined;
    let lineNumber: number | undefined;

    if (this.config.captureSourceLocation) {
      const location = captureSourceLocation(skipFrames);
      if (location) {
        sourceFile = location.sourceFile;
        lineNumber = location.lineNumber;
      }
    }

    const fullEntry: LogEntry = {
      ...entry,
      timestamp: entry.timestamp ?? new Date().toISOString(),
      service: entry.service ?? this.config.service,
      metadata: this.mergeMetadata(entry.metadata),
      ...(sourceFile !== undefined && { sourceFile }),
      ...(lineNumber !== undefined && { lineNumber }),
    };

    this.queue.add(fullEntry);
  }

  /**
   * Log a message at the specified level
   */
  log(entry: LogEntry): void {
    this._addLog(entry, 2);
  }

  /**
   * Log a debug message
   */
  debug(message: string, metadata?: Record<string, unknown>): void {
    this._addLog({ level: 'debug', message, metadata }, 2);
  }

  /**
   * Log an info message
   */
  info(message: string, metadata?: Record<string, unknown>): void {
    this._addLog({ level: 'info', message, metadata }, 2);
  }

  /**
   * Log a warning message
   */
  warn(message: string, metadata?: Record<string, unknown>): void {
    this._addLog({ level: 'warn', message, metadata }, 2);
  }

  /**
   * Log an error message
   */
  error(message: string, metadata?: Record<string, unknown>): void {
    this._addLog({ level: 'error', message, metadata }, 2);
  }

  /**
   * Log a fatal error message
   */
  fatal(message: string, metadata?: Record<string, unknown>): void {
    this._addLog({ level: 'fatal', message, metadata }, 2);
  }

  /**
   * Flush all queued logs immediately
   *
   * @returns Response from the server, or null if queue was empty
   */
  async flush(): Promise<IngestResponse | null> {
    return this.queue.flush();
  }

  /**
   * Flush remaining logs and stop the client
   *
   * Call this before process exit to ensure all logs are sent.
   */
  async shutdown(): Promise<void> {
    this.stopped = true;
    await this.queue.shutdown();
  }

  /**
   * Create a child logger with additional context
   *
   * Child loggers share the same queue as the parent,
   * but can have their own service name and default metadata.
   *
   * @example
   * ```ts
   * const requestLogger = logger.child({
   *   metadata: { requestId: req.id },
   * });
   * requestLogger.info('Request received');
   * ```
   */
  child(options: ChildLoggerOptions): Logwell {
    const childConfig: LogwellConfig = {
      ...this.config,
      service: options.service ?? this.config.service,
    };

    const childMetadata = {
      ...this.parentMetadata,
      ...options.metadata,
    };

    return new Logwell(childConfig, this.queue, childMetadata);
  }

  private mergeMetadata(
    entryMetadata?: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    if (!this.parentMetadata && !entryMetadata) {
      return undefined;
    }
    return {
      ...this.parentMetadata,
      ...entryMetadata,
    };
  }
}
