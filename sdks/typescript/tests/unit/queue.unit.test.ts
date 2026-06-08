import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { BatchQueue, type QueueConfig, type SendBatchFn } from "../../src/queue";
import { createLogBatch, createLogFixture } from "../fixtures/logs";

describe("BatchQueue", () => {
  let mockSendBatch: SendBatchFn;
  let defaultConfig: QueueConfig;

  beforeEach(() => {
    vi.useFakeTimers();
    mockSendBatch = vi.fn().mockResolvedValue({ accepted: 1 });
    defaultConfig = {
      batchSize: 5,
      flushInterval: 1000,
      maxQueueSize: 100,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("constructor", () => {
    it("creates queue with config", () => {
      const queue = new BatchQueue(mockSendBatch, defaultConfig);

      expect(queue).toBeInstanceOf(BatchQueue);
      expect(queue.size).toBe(0);
    });
  });

  describe("add", () => {
    it("adds entry to queue", () => {
      const queue = new BatchQueue(mockSendBatch, defaultConfig);
      const log = createLogFixture();

      queue.add(log);

      expect(queue.size).toBe(1);
    });

    it("increments size for each added entry", () => {
      const queue = new BatchQueue(mockSendBatch, defaultConfig);

      queue.add(createLogFixture());
      queue.add(createLogFixture());
      queue.add(createLogFixture());

      expect(queue.size).toBe(3);
    });

    it("triggers flush when batchSize reached", async () => {
      const queue = new BatchQueue(mockSendBatch, defaultConfig);
      const logs = createLogBatch(5);

      for (const log of logs) {
        queue.add(log);
      }

      // Allow microtask queue to process
      await vi.runAllTimersAsync();

      expect(mockSendBatch).toHaveBeenCalledTimes(1);
      expect(mockSendBatch).toHaveBeenCalledWith(logs);
    });

    it("does not flush before batchSize reached", () => {
      const queue = new BatchQueue(mockSendBatch, defaultConfig);

      queue.add(createLogFixture());
      queue.add(createLogFixture());

      expect(mockSendBatch).not.toHaveBeenCalled();
    });
  });

  describe("flush interval", () => {
    it("flushes after flushInterval elapsed", async () => {
      const queue = new BatchQueue(mockSendBatch, defaultConfig);
      const log = createLogFixture();

      queue.add(log);

      // Fast-forward time
      await vi.advanceTimersByTimeAsync(1000);

      expect(mockSendBatch).toHaveBeenCalledTimes(1);
      expect(mockSendBatch).toHaveBeenCalledWith([log]);
    });

    it("does not flush if queue is empty", async () => {
      new BatchQueue(mockSendBatch, defaultConfig);

      await vi.advanceTimersByTimeAsync(1000);

      expect(mockSendBatch).not.toHaveBeenCalled();
    });

    it("resets timer after manual flush", async () => {
      const queue = new BatchQueue(mockSendBatch, defaultConfig);

      queue.add(createLogFixture());
      await queue.flush();

      // Add another and wait for interval
      queue.add(createLogFixture());
      await vi.advanceTimersByTimeAsync(1000);

      expect(mockSendBatch).toHaveBeenCalledTimes(2);
    });
  });

  describe("flush", () => {
    it("sends all queued logs", async () => {
      const queue = new BatchQueue(mockSendBatch, defaultConfig);
      const logs = createLogBatch(3);

      for (const log of logs) {
        queue.add(log);
      }

      await queue.flush();

      expect(mockSendBatch).toHaveBeenCalledWith(logs);
      expect(queue.size).toBe(0);
    });

    it("returns response from sendBatch", async () => {
      mockSendBatch = vi.fn().mockResolvedValue({ accepted: 3 });
      const queue = new BatchQueue(mockSendBatch, defaultConfig);

      queue.add(createLogFixture());
      queue.add(createLogFixture());
      queue.add(createLogFixture());

      const response = await queue.flush();

      expect(response).toEqual({ accepted: 3 });
    });

    it("returns null if queue is empty", async () => {
      const queue = new BatchQueue(mockSendBatch, defaultConfig);

      const response = await queue.flush();

      expect(response).toBeNull();
      expect(mockSendBatch).not.toHaveBeenCalled();
    });

    it("clears queue after successful flush", async () => {
      const queue = new BatchQueue(mockSendBatch, defaultConfig);

      queue.add(createLogFixture());
      queue.add(createLogFixture());

      await queue.flush();

      expect(queue.size).toBe(0);
    });

    it("preserves log order", async () => {
      const queue = new BatchQueue(mockSendBatch, defaultConfig);
      const log1 = createLogFixture({ message: "first" });
      const log2 = createLogFixture({ message: "second" });
      const log3 = createLogFixture({ message: "third" });

      queue.add(log1);
      queue.add(log2);
      queue.add(log3);

      await queue.flush();

      expect(mockSendBatch).toHaveBeenCalledWith([log1, log2, log3]);
    });
  });

  describe("queue overflow", () => {
    it("drops oldest logs when maxQueueSize exceeded", () => {
      const config = { ...defaultConfig, maxQueueSize: 3 };
      const queue = new BatchQueue(mockSendBatch, config);

      const log1 = createLogFixture({ message: "oldest" });
      const log2 = createLogFixture({ message: "middle" });
      const log3 = createLogFixture({ message: "newest1" });
      const log4 = createLogFixture({ message: "newest2" });

      queue.add(log1);
      queue.add(log2);
      queue.add(log3);
      queue.add(log4);

      expect(queue.size).toBe(3);
    });

    it("calls onError when overflow occurs", () => {
      const onError = vi.fn();
      const config = { ...defaultConfig, maxQueueSize: 2, onError };
      const queue = new BatchQueue(mockSendBatch, config);

      queue.add(createLogFixture({ message: "first" }));
      queue.add(createLogFixture({ message: "second" }));
      queue.add(createLogFixture({ message: "overflow" }));

      expect(onError).toHaveBeenCalled();
      expect(onError.mock.calls[0][0].message).toContain("overflow");
    });
  });

  describe("callbacks", () => {
    it("calls onFlush after successful flush", async () => {
      const onFlush = vi.fn();
      const config = { ...defaultConfig, onFlush };
      const queue = new BatchQueue(mockSendBatch, config);

      queue.add(createLogFixture());
      queue.add(createLogFixture());

      await queue.flush();

      expect(onFlush).toHaveBeenCalledWith(2);
    });

    it("calls onError on send failure", async () => {
      const onError = vi.fn();
      const error = new Error("Send failed");
      mockSendBatch = vi.fn().mockRejectedValue(error);
      const config = { ...defaultConfig, onError };
      const queue = new BatchQueue(mockSendBatch, config);

      queue.add(createLogFixture());

      await queue.flush();

      expect(onError).toHaveBeenCalledWith(error);
    });

    it("re-queues logs on send failure", async () => {
      const error = new Error("Send failed");
      mockSendBatch = vi.fn().mockRejectedValueOnce(error).mockResolvedValue({ accepted: 1 });
      const queue = new BatchQueue(mockSendBatch, defaultConfig);

      queue.add(createLogFixture());

      await queue.flush();

      // Logs should be re-queued
      expect(queue.size).toBe(1);
    });
  });

  describe("shutdown", () => {
    it("flushes remaining logs", async () => {
      const queue = new BatchQueue(mockSendBatch, defaultConfig);

      queue.add(createLogFixture());
      queue.add(createLogFixture());

      await queue.shutdown();

      expect(mockSendBatch).toHaveBeenCalled();
      expect(queue.size).toBe(0);
    });

    it("stops timer after shutdown", async () => {
      const queue = new BatchQueue(mockSendBatch, defaultConfig);

      queue.add(createLogFixture());
      await queue.shutdown();

      // Add more and advance time
      queue.add(createLogFixture());
      await vi.advanceTimersByTimeAsync(2000);

      // Should only be called once (from shutdown flush)
      expect(mockSendBatch).toHaveBeenCalledTimes(1);
    });

    it("handles multiple shutdown calls gracefully", async () => {
      const queue = new BatchQueue(mockSendBatch, defaultConfig);

      queue.add(createLogFixture());

      await queue.shutdown();
      await queue.shutdown();
      await queue.shutdown();

      expect(mockSendBatch).toHaveBeenCalledTimes(1);
    });
  });

  describe("concurrent operations", () => {
    it("handles concurrent add and flush", async () => {
      const queue = new BatchQueue(mockSendBatch, defaultConfig);

      // Add logs while flushing
      queue.add(createLogFixture());
      const flushPromise = queue.flush();
      queue.add(createLogFixture());

      await flushPromise;

      // Second log should still be in queue
      expect(queue.size).toBe(1);
    });

    it("prevents concurrent flushes", async () => {
      let resolveFirst: () => void;
      const firstFlush = new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });
      mockSendBatch = vi.fn().mockImplementation(() => firstFlush.then(() => ({ accepted: 1 })));

      const queue = new BatchQueue(mockSendBatch, defaultConfig);
      queue.add(createLogFixture());

      const flush1 = queue.flush();
      const flush2 = queue.flush();

      resolveFirst?.();
      await flush1;
      await flush2;

      // Should only send once
      expect(mockSendBatch).toHaveBeenCalledTimes(1);
    });
  });
});
