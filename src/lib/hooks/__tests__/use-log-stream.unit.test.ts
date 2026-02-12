/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import type { ClientLog } from '$lib/stores/logs.svelte';

/**
 * Helper to create a mock SSE response with a readable stream
 */
function createMockSSEResponse(events: Array<{ event: string; data: string }>): Response {
  let eventIndex = 0;

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (eventIndex < events.length) {
        const event = events[eventIndex];
        const sseData = `event: ${event.event}\ndata: ${event.data}\n\n`;
        controller.enqueue(new TextEncoder().encode(sseData));
        eventIndex++;
      } else {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

/**
 * Helper to create a mock SSE response that delays between events
 */
function createDelayedMockSSEResponse(
  events: Array<{ event: string; data: string; delayMs?: number }>,
): Response {
  let eventIndex = 0;

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (eventIndex < events.length) {
        const event = events[eventIndex];
        if (event.delayMs) {
          await new Promise((resolve) => setTimeout(resolve, event.delayMs));
        }
        const sseData = `event: ${event.event}\ndata: ${event.data}\n\n`;
        controller.enqueue(new TextEncoder().encode(sseData));
        eventIndex++;
      } else {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

/**
 * Helper to create a mock response that errors
 */
function createErrorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Helper to create sample log data
 */
function createSampleLog(overrides: Partial<ClientLog> = {}): ClientLog {
  return {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    projectId: 'test-project',
    level: 'info',
    message: 'Test log message',
    metadata: null,
    incidentId: null,
    fingerprint: null,
    serviceName: null,
    sourceFile: null,
    lineNumber: null,
    requestId: null,
    userId: null,
    ipAddress: null,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('useLogStream', () => {
  let fetchMock: MockInstance;
  let useLogStream: typeof import('../use-log-stream.svelte').useLogStream;

  beforeEach(async () => {
    vi.resetModules();
    fetchMock = vi.spyOn(globalThis, 'fetch');

    // Import fresh module for each test
    const module = await import('../use-log-stream.svelte');
    useLogStream = module.useLogStream;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('connection', () => {
    it('connects to SSE endpoint when enabled', async () => {
      const mockResponse = createMockSSEResponse([
        { event: 'heartbeat', data: JSON.stringify({ ts: Date.now() }) },
      ]);
      fetchMock.mockResolvedValueOnce(mockResponse);

      const onLogs = vi.fn();
      const stream = useLogStream({
        projectId: 'test-project',
        enabled: true,
        onLogs,
      });

      // Wait for connection attempt
      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalled();
      });

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/projects/test-project/logs/stream',
        expect.objectContaining({
          method: 'POST',
          credentials: 'same-origin',
        }),
      );

      stream.disconnect();
    });

    it('does not connect when enabled is false', async () => {
      const onLogs = vi.fn();
      useLogStream({
        projectId: 'test-project',
        enabled: false,
        onLogs,
      });

      // Wait a tick to ensure no fetch was called
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reports connecting state during connection', async () => {
      let resolveResponse!: (value: Response) => void;
      const responsePromise = new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      });
      fetchMock.mockReturnValueOnce(responsePromise);

      const stream = useLogStream({
        projectId: 'test-project',
        enabled: true,
        onLogs: vi.fn(),
      });

      // Should be connecting while waiting for response
      await vi.waitFor(() => {
        expect(stream.isConnecting).toBe(true);
      });

      // Resolve the fetch
      resolveResponse(
        createMockSSEResponse([{ event: 'heartbeat', data: JSON.stringify({ ts: Date.now() }) }]),
      );

      await vi.waitFor(() => {
        expect(stream.isConnecting).toBe(false);
      });

      stream.disconnect();
    });

    it('reports connected state after successful connection', async () => {
      const mockResponse = createDelayedMockSSEResponse([
        { event: 'heartbeat', data: JSON.stringify({ ts: Date.now() }), delayMs: 100 },
        { event: 'heartbeat', data: JSON.stringify({ ts: Date.now() }), delayMs: 100 },
      ]);
      fetchMock.mockResolvedValueOnce(mockResponse);

      const stream = useLogStream({
        projectId: 'test-project',
        enabled: true,
        onLogs: vi.fn(),
      });

      await vi.waitFor(() => {
        expect(stream.isConnected).toBe(true);
      });

      stream.disconnect();
    });
  });

  describe('parsing log batches', () => {
    it('parses incoming log batches and calls onLogs', async () => {
      const logs = [createSampleLog({ id: 'log-1' }), createSampleLog({ id: 'log-2' })];

      const mockResponse = createMockSSEResponse([{ event: 'logs', data: JSON.stringify(logs) }]);
      fetchMock.mockResolvedValueOnce(mockResponse);

      const onLogs = vi.fn();
      const stream = useLogStream({
        projectId: 'test-project',
        enabled: true,
        onLogs,
      });

      await vi.waitFor(() => {
        expect(onLogs).toHaveBeenCalled();
      });

      expect(onLogs).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 'log-1' }),
          expect.objectContaining({ id: 'log-2' }),
        ]),
      );

      stream.disconnect();
    });

    it('handles multiple log batches sequentially', async () => {
      const batch1 = [createSampleLog({ id: 'batch1-log-1' })];
      const batch2 = [createSampleLog({ id: 'batch2-log-1' })];

      const mockResponse = createDelayedMockSSEResponse([
        { event: 'logs', data: JSON.stringify(batch1), delayMs: 10 },
        { event: 'logs', data: JSON.stringify(batch2), delayMs: 10 },
      ]);
      fetchMock.mockResolvedValueOnce(mockResponse);

      const onLogs = vi.fn();
      const stream = useLogStream({
        projectId: 'test-project',
        enabled: true,
        onLogs,
      });

      await vi.waitFor(() => {
        expect(onLogs).toHaveBeenCalledTimes(2);
      });

      expect(onLogs).toHaveBeenNthCalledWith(
        1,
        expect.arrayContaining([expect.objectContaining({ id: 'batch1-log-1' })]),
      );
      expect(onLogs).toHaveBeenNthCalledWith(
        2,
        expect.arrayContaining([expect.objectContaining({ id: 'batch2-log-1' })]),
      );

      stream.disconnect();
    });

    it('ignores heartbeat events', async () => {
      const mockResponse = createMockSSEResponse([
        { event: 'heartbeat', data: JSON.stringify({ ts: Date.now() }) },
        { event: 'heartbeat', data: JSON.stringify({ ts: Date.now() }) },
      ]);
      fetchMock.mockResolvedValueOnce(mockResponse);

      const onLogs = vi.fn();
      const stream = useLogStream({
        projectId: 'test-project',
        enabled: true,
        onLogs,
      });

      // Wait for stream to process
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(onLogs).not.toHaveBeenCalled();

      stream.disconnect();
    });

    it('handles malformed JSON gracefully', async () => {
      const mockResponse = createMockSSEResponse([
        { event: 'logs', data: 'not valid json' },
        {
          event: 'logs',
          data: JSON.stringify([createSampleLog({ id: 'valid-log' })]),
        },
      ]);
      fetchMock.mockResolvedValueOnce(mockResponse);

      const onLogs = vi.fn();
      const onError = vi.fn();
      const stream = useLogStream({
        projectId: 'test-project',
        enabled: true,
        onLogs,
        onError,
      });

      await vi.waitFor(() => {
        expect(onLogs).toHaveBeenCalled();
      });

      // Should still process the valid batch
      expect(onLogs).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ id: 'valid-log' })]),
      );

      stream.disconnect();
    });
  });

  describe('reconnection', () => {
    it('attempts reconnection after connection error', async () => {
      vi.useFakeTimers();

      // First connection fails
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      // Second connection succeeds
      const mockResponse = createMockSSEResponse([
        { event: 'heartbeat', data: JSON.stringify({ ts: Date.now() }) },
      ]);
      fetchMock.mockResolvedValueOnce(mockResponse);

      const onError = vi.fn();
      const stream = useLogStream({
        projectId: 'test-project',
        enabled: true,
        onLogs: vi.fn(),
        onError,
      });

      // Wait for first connection attempt
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Advance timer to trigger reconnection (default: 3000ms)
      await vi.advanceTimersByTimeAsync(3000);

      expect(fetchMock).toHaveBeenCalledTimes(2);

      stream.disconnect();
      vi.useRealTimers();
    });

    it('uses exponential backoff for reconnection', async () => {
      vi.useFakeTimers();

      // All connections fail
      fetchMock.mockRejectedValue(new Error('Network error'));

      const stream = useLogStream({
        projectId: 'test-project',
        enabled: true,
        onLogs: vi.fn(),
      });

      // First attempt
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Second attempt after 3s
      await vi.advanceTimersByTimeAsync(3000);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // Third attempt after 6s (exponential backoff)
      await vi.advanceTimersByTimeAsync(6000);
      expect(fetchMock).toHaveBeenCalledTimes(3);

      stream.disconnect();
      vi.useRealTimers();
    });

    it('resets reconnection attempts on successful connection', async () => {
      vi.useFakeTimers();

      // First fails, second succeeds, third (after disconnect) succeeds
      fetchMock
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(
          createMockSSEResponse([{ event: 'heartbeat', data: JSON.stringify({ ts: Date.now() }) }]),
        );

      const stream = useLogStream({
        projectId: 'test-project',
        enabled: true,
        onLogs: vi.fn(),
      });

      // First attempt fails
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Reconnect after 3s succeeds
      await vi.advanceTimersByTimeAsync(3000);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      stream.disconnect();
      vi.useRealTimers();
    });

    it('stops reconnection when disabled', async () => {
      vi.useFakeTimers();

      fetchMock.mockRejectedValue(new Error('Network error'));

      const stream = useLogStream({
        projectId: 'test-project',
        enabled: true,
        onLogs: vi.fn(),
      });

      // First attempt
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Disconnect before reconnection
      stream.disconnect();

      // Advance timer past reconnection time
      await vi.advanceTimersByTimeAsync(10000);

      // Should not have attempted reconnection
      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it('caps max reconnection attempts', async () => {
      vi.useFakeTimers();

      fetchMock.mockRejectedValue(new Error('Network error'));

      const onError = vi.fn();
      const stream = useLogStream({
        projectId: 'test-project',
        enabled: true,
        onLogs: vi.fn(),
        onError,
        maxReconnectAttempts: 3, // 3 reconnect attempts AFTER initial failure
      });

      // First attempt (initial)
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // 1st reconnect after 3s
      await vi.advanceTimersByTimeAsync(3000);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // 2nd reconnect after 6s (exponential backoff)
      await vi.advanceTimersByTimeAsync(6000);
      expect(fetchMock).toHaveBeenCalledTimes(3);

      // 3rd reconnect after 12s (exponential backoff)
      await vi.advanceTimersByTimeAsync(12000);
      expect(fetchMock).toHaveBeenCalledTimes(4);

      // Should NOT attempt 4th reconnect (total: 1 initial + 3 reconnects = 4)
      await vi.advanceTimersByTimeAsync(24000);
      expect(fetchMock).toHaveBeenCalledTimes(4);

      stream.disconnect();
      vi.useRealTimers();
    });
  });

  describe('cleanup', () => {
    it('disconnects when calling disconnect()', async () => {
      const abortSpy = vi.spyOn(AbortController.prototype, 'abort');

      const mockResponse = createDelayedMockSSEResponse([
        { event: 'heartbeat', data: JSON.stringify({ ts: Date.now() }), delayMs: 1000 },
      ]);
      fetchMock.mockResolvedValueOnce(mockResponse);

      const stream = useLogStream({
        projectId: 'test-project',
        enabled: true,
        onLogs: vi.fn(),
      });

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalled();
      });

      stream.disconnect();

      expect(abortSpy).toHaveBeenCalled();
    });

    it('cleans up pending reconnection timers on disconnect', async () => {
      vi.useFakeTimers();
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const stream = useLogStream({
        projectId: 'test-project',
        enabled: true,
        onLogs: vi.fn(),
      });

      // First attempt fails
      await vi.advanceTimersByTimeAsync(0);

      // Disconnect while reconnection is scheduled
      stream.disconnect();

      expect(clearTimeoutSpy).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('reports disconnected state after disconnect', async () => {
      const mockResponse = createDelayedMockSSEResponse([
        { event: 'heartbeat', data: JSON.stringify({ ts: Date.now() }), delayMs: 100 },
      ]);
      fetchMock.mockResolvedValueOnce(mockResponse);

      const stream = useLogStream({
        projectId: 'test-project',
        enabled: true,
        onLogs: vi.fn(),
      });

      await vi.waitFor(() => {
        expect(stream.isConnected).toBe(true);
      });

      stream.disconnect();

      expect(stream.isConnected).toBe(false);
      expect(stream.isConnecting).toBe(false);
    });

    it('can reconnect after manual disconnect', async () => {
      const mockResponse1 = createMockSSEResponse([
        { event: 'heartbeat', data: JSON.stringify({ ts: Date.now() }) },
      ]);
      const mockResponse2 = createMockSSEResponse([
        { event: 'heartbeat', data: JSON.stringify({ ts: Date.now() }) },
      ]);
      fetchMock.mockResolvedValueOnce(mockResponse1).mockResolvedValueOnce(mockResponse2);

      const stream = useLogStream({
        projectId: 'test-project',
        enabled: true,
        onLogs: vi.fn(),
      });

      // Wait for first connection
      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });

      stream.disconnect();
      stream.connect();

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(2);
      });

      stream.disconnect();
    });
  });

  describe('error handling', () => {
    it('calls onError when connection fails', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const onError = vi.fn();
      const stream = useLogStream({
        projectId: 'test-project',
        enabled: true,
        onLogs: vi.fn(),
        onError,
      });

      await vi.waitFor(() => {
        expect(onError).toHaveBeenCalled();
      });

      expect(onError).toHaveBeenCalledWith(expect.any(Error));

      stream.disconnect();
    });

    it('calls onError when server returns error status', async () => {
      fetchMock.mockResolvedValueOnce(createErrorResponse(401, 'Unauthorized'));

      const onError = vi.fn();
      const stream = useLogStream({
        projectId: 'test-project',
        enabled: true,
        onLogs: vi.fn(),
        onError,
      });

      await vi.waitFor(() => {
        expect(onError).toHaveBeenCalled();
      });

      stream.disconnect();
    });

    it('exposes error state', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const stream = useLogStream({
        projectId: 'test-project',
        enabled: true,
        onLogs: vi.fn(),
      });

      await vi.waitFor(() => {
        expect(stream.error).not.toBeNull();
      });

      expect(stream.error?.message).toBe('Network error');

      stream.disconnect();
    });
  });

  describe('connection change callback', () => {
    it('calls onConnectionChange when connected', async () => {
      const mockResponse = createDelayedMockSSEResponse([
        { event: 'heartbeat', data: JSON.stringify({ ts: Date.now() }), delayMs: 100 },
      ]);
      fetchMock.mockResolvedValueOnce(mockResponse);

      const onConnectionChange = vi.fn();
      const stream = useLogStream({
        projectId: 'test-project',
        enabled: true,
        onLogs: vi.fn(),
        onConnectionChange,
      });

      await vi.waitFor(() => {
        expect(onConnectionChange).toHaveBeenCalledWith(true);
      });

      stream.disconnect();
    });

    it('calls onConnectionChange when disconnected', async () => {
      const mockResponse = createDelayedMockSSEResponse([
        { event: 'heartbeat', data: JSON.stringify({ ts: Date.now() }), delayMs: 100 },
      ]);
      fetchMock.mockResolvedValueOnce(mockResponse);

      const onConnectionChange = vi.fn();
      const stream = useLogStream({
        projectId: 'test-project',
        enabled: true,
        onLogs: vi.fn(),
        onConnectionChange,
      });

      await vi.waitFor(() => {
        expect(stream.isConnected).toBe(true);
      });

      stream.disconnect();

      await vi.waitFor(() => {
        expect(onConnectionChange).toHaveBeenCalledWith(false);
      });
    });
  });
});
