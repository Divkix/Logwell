import { LogwellError } from './errors';
import type { IngestResponse, LogEntry } from './types';

/**
 * Callback type for sending batched logs
 */
export type SendBatchFn = (logs: LogEntry[]) => Promise<IngestResponse>;

/**
 * Queue configuration options
 */
export interface QueueConfig {
  batchSize: number;
  flushInterval: number;
  maxQueueSize: number;
  onError?: (error: Error) => void;
  onFlush?: (count: number) => void;
}

/**
 * Batch queue for buffering and sending logs
 *
 * Features:
 * - Automatic flush on batch size threshold
 * - Automatic flush on time interval
 * - Queue overflow protection (drops oldest)
 * - Re-queue on send failure
 * - Graceful shutdown
 */
export class BatchQueue {
  private queue: LogEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private stopped = false;

  constructor(
    private sendBatch: SendBatchFn,
    private config: QueueConfig,
  ) {}

  /**
   * Current number of logs in the queue
   */
  get size(): number {
    return this.queue.length;
  }

  /**
   * Add a log entry to the queue
   *
   * Triggers flush if batch size is reached.
   * Drops oldest log if queue overflows.
   */
  add(entry: LogEntry): void {
    if (this.stopped) {
      return;
    }

    // Handle queue overflow
    if (this.queue.length >= this.config.maxQueueSize) {
      const dropped = this.queue.shift();
      this.config.onError?.(
        new LogwellError(
          `Queue overflow. Dropped log: ${dropped?.message.substring(0, 50)}...`,
          'QUEUE_OVERFLOW',
        ),
      );
    }

    this.queue.push(entry);

    // Start timer on first entry
    if (!this.flushTimer && !this.stopped) {
      this.startTimer();
    }

    // Flush immediately if batch size reached
    if (this.queue.length >= this.config.batchSize) {
      void this.flush();
    }
  }

  /**
   * Flush all queued logs immediately
   *
   * Sends in chunks bounded by batchSize.
   * @returns Last response from the server, or null if queue was empty
   */
  async flush(): Promise<IngestResponse | null> {
    // Prevent concurrent flushes
    if (this.flushing || this.queue.length === 0) {
      return null;
    }

    this.flushing = true;
    this.stopTimer();

    // Snapshot current queue length so concurrent adds during flush are deferred
    const snapshotLength = this.queue.length;
    let sent = 0;
    let lastResponse: IngestResponse | null = null;
    try {
      // Send in chunks bounded by batchSize, up to the snapshot count
      while (sent < snapshotLength) {
        const remaining = snapshotLength - sent;
        const chunkSize = Math.min(this.config.batchSize, remaining);
        const batch = this.queue.splice(0, chunkSize);
        sent += batch.length;
        try {
          const response = await this.sendBatch(batch);
          this.config.onFlush?.(batch.length);
          lastResponse = response;
        } catch (error) {
          // Re-queue failed batch at front, respect maxQueueSize
          const requeued = [...batch, ...this.queue];
          this.queue.length = 0;
          this.queue.push(...requeued.slice(0, this.config.maxQueueSize));
          if (requeued.length > this.config.maxQueueSize) {
            this.config.onError?.(
              new LogwellError(
                `Queue overflow: dropped ${requeued.length - this.config.maxQueueSize} logs`,
                'QUEUE_OVERFLOW',
              ),
            );
          }
          this.config.onError?.(error as Error);
          break; // stop flushing on error
        }
      }
    } finally {
      this.flushing = false;
      if (this.queue.length > 0 && !this.stopped) {
        this.startTimer();
      }
    }
    return lastResponse;
  }

  /**
   * Flush remaining logs and stop the queue
   *
   * @returns Last response from the server, or null if queue was empty
   */
  async shutdown(): Promise<IngestResponse | null> {
    if (this.stopped) {
      return null;
    }

    this.stopped = true;
    this.stopTimer();

    if (this.queue.length > 0) {
      return this.flush();
    }
    return null;
  }

  private startTimer(): void {
    this.flushTimer = setTimeout(() => {
      void this.flush();
    }, this.config.flushInterval);
  }

  private stopTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
}
