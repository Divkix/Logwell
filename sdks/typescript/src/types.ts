/**
 * Valid log levels matching Logwell server
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Single log entry for the simple API
 */
export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp?: string;
  service?: string;
  metadata?: Record<string, unknown>;
  /** Source file path where the log was called */
  sourceFile?: string;
  /** Line number in the source file where the log was called */
  lineNumber?: number;
}

/**
 * SDK configuration options
 */
export interface LogwellConfig {
  /** API key in format lw_[32chars] */
  apiKey: string;
  /** Logwell server endpoint URL */
  endpoint: string;
  /** Default service name for all logs */
  service?: string;
  /** Max logs before auto-flush (default: 50) */
  batchSize?: number;
  /** Auto-flush interval in ms (default: 5000) */
  flushInterval?: number;
  /** Max queue size before dropping oldest (default: 1000) */
  maxQueueSize?: number;
  /** Max retry attempts (default: 3) */
  maxRetries?: number;
  /** Capture source file and line number (default: false). Has performance overhead when enabled. */
  captureSourceLocation?: boolean;
  /** Called on send failures */
  onError?: (error: Error) => void;
  /** Called after successful flush */
  onFlush?: (count: number) => void;
}

/**
 * Response from the ingest endpoint
 */
export interface IngestResponse {
  accepted: number;
  rejected?: number;
  errors?: string[];
}
