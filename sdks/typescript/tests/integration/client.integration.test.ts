import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logwell } from '../../src/client';
import { LogwellError } from '../../src/errors';
import type { LogEntry, LogwellConfig } from '../../src/types';
import { validConfigs } from '../fixtures/configs';
import { allLogLevels } from '../fixtures/logs';
import { errorHandlers } from '../mocks/handlers';
import { server } from '../mocks/server';

describe('Logwell Client', () => {
  let defaultConfig: LogwellConfig;
  let capturedLogs: LogEntry[];

  beforeEach(() => {
    vi.useFakeTimers();
    capturedLogs = [];
    defaultConfig = {
      ...validConfigs.minimal,
      batchSize: 5,
      flushInterval: 1000,
    };

    // Capture all logs sent to the server
    server.use(
      http.post('*/v1/ingest', async ({ request }) => {
        const body = (await request.json()) as LogEntry[];
        capturedLogs.push(...body);
        return HttpResponse.json({ accepted: body.length });
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('creates client with valid config', () => {
      const client = new Logwell(defaultConfig);
      expect(client).toBeInstanceOf(Logwell);
    });

    it('throws on invalid config', () => {
      expect(() => new Logwell({ apiKey: 'invalid' } as LogwellConfig)).toThrow(LogwellError);
    });

    it('initializes with zero queue size', () => {
      const client = new Logwell(defaultConfig);
      expect(client.queueSize).toBe(0);
    });
  });

  describe('log methods', () => {
    it.each(allLogLevels)('%s() logs with correct level', async (level) => {
      const client = new Logwell(defaultConfig);

      client[level](`Test ${level} message`);
      await client.flush();

      expect(capturedLogs).toHaveLength(1);
      expect(capturedLogs[0].level).toBe(level);
      expect(capturedLogs[0].message).toBe(`Test ${level} message`);
    });

    it('log() sends log with specified level', async () => {
      const client = new Logwell(defaultConfig);

      client.log({ level: 'error', message: 'Custom log' });
      await client.flush();

      expect(capturedLogs).toHaveLength(1);
      expect(capturedLogs[0].level).toBe('error');
    });

    it('includes metadata in log', async () => {
      const client = new Logwell(defaultConfig);
      const metadata = { userId: '123', action: 'login' };

      client.info('User action', metadata);
      await client.flush();

      expect(capturedLogs[0].metadata).toEqual(metadata);
    });

    it('includes service name from config', async () => {
      const client = new Logwell({
        ...defaultConfig,
        service: 'test-service',
      });

      client.info('With service');
      await client.flush();

      expect(capturedLogs[0].service).toBe('test-service');
    });

    it('adds timestamp to log', async () => {
      const client = new Logwell(defaultConfig);

      client.info('Timestamped log');
      await client.flush();

      expect(capturedLogs[0].timestamp).toBeDefined();
      // Should be ISO8601 format
      const timestamp = capturedLogs[0].timestamp as string;
      expect(new Date(timestamp).toISOString()).toBe(timestamp);
    });
  });

  describe('batching', () => {
    it('queues logs until batch size', async () => {
      const client = new Logwell(defaultConfig);

      client.info('Log 1');
      client.info('Log 2');
      client.info('Log 3');

      expect(client.queueSize).toBe(3);
      expect(capturedLogs).toHaveLength(0);
    });

    it('auto-flushes when batch size reached', async () => {
      const client = new Logwell(defaultConfig);

      // Add 5 logs (batchSize is 5)
      for (let i = 0; i < 5; i++) {
        client.info(`Log ${i + 1}`);
      }

      await vi.runAllTimersAsync();

      expect(capturedLogs).toHaveLength(5);
      expect(client.queueSize).toBe(0);
    });

    it('auto-flushes after flush interval', async () => {
      const client = new Logwell(defaultConfig);

      client.info('Delayed log');

      await vi.advanceTimersByTimeAsync(1000);

      expect(capturedLogs).toHaveLength(1);
    });
  });

  describe('flush', () => {
    it('sends all queued logs', async () => {
      const client = new Logwell(defaultConfig);

      client.info('Log 1');
      client.info('Log 2');

      await client.flush();

      expect(capturedLogs).toHaveLength(2);
      expect(client.queueSize).toBe(0);
    });

    it('returns response from server', async () => {
      const client = new Logwell(defaultConfig);

      client.info('Log 1');
      client.info('Log 2');

      const response = await client.flush();

      expect(response?.accepted).toBe(2);
    });

    it('returns null if queue is empty', async () => {
      const client = new Logwell(defaultConfig);

      const response = await client.flush();

      expect(response).toBeNull();
    });
  });

  describe('shutdown', () => {
    it('flushes remaining logs', async () => {
      const client = new Logwell(defaultConfig);

      client.info('Final log');

      await client.shutdown();

      expect(capturedLogs).toHaveLength(1);
    });

    it('prevents further logging after shutdown', async () => {
      const client = new Logwell(defaultConfig);

      await client.shutdown();
      client.info('Should be ignored');

      expect(client.queueSize).toBe(0);
    });
  });

  describe('callbacks', () => {
    it('calls onFlush after successful flush', async () => {
      const onFlush = vi.fn();
      const client = new Logwell({ ...defaultConfig, onFlush });

      client.info('Log 1');
      client.info('Log 2');
      await client.flush();

      expect(onFlush).toHaveBeenCalledWith(2);
    });

    it('calls onError on send failure', async () => {
      // Use real timers for this test
      vi.useRealTimers();

      const onError = vi.fn();
      server.use(errorHandlers.unauthorized); // 401 is not retryable

      const client = new Logwell({
        ...defaultConfig,
        onError,
      });

      client.info('Will fail');
      await client.flush();

      expect(onError).toHaveBeenCalled();
    });
  });

  describe('child logger', () => {
    it('creates child with inherited config', async () => {
      const client = new Logwell({
        ...defaultConfig,
        service: 'parent-service',
      });

      const child = client.child({});
      child.info('From child');
      await child.flush();

      expect(capturedLogs[0].service).toBe('parent-service');
    });

    it('child can override service', async () => {
      const client = new Logwell({
        ...defaultConfig,
        service: 'parent-service',
      });

      const child = client.child({ service: 'child-service' });
      child.info('From child');
      await child.flush();

      expect(capturedLogs[0].service).toBe('child-service');
    });

    it('child merges metadata', async () => {
      const client = new Logwell(defaultConfig);

      const child = client.child({
        metadata: { requestId: 'req-123' },
      });
      child.info('With context', { extra: 'data' });
      await child.flush();

      expect(capturedLogs[0].metadata).toEqual({
        requestId: 'req-123',
        extra: 'data',
      });
    });

    it('child shares queue with parent', async () => {
      const client = new Logwell(defaultConfig);
      const child = client.child({});

      client.info('Parent log');
      child.info('Child log');

      expect(client.queueSize).toBe(2);

      await client.flush();

      expect(capturedLogs).toHaveLength(2);
    });
  });

  describe('error handling', () => {
    it('continues working after transient error', async () => {
      // Use real timers for this test since it involves actual retries
      vi.useRealTimers();

      let attempts = 0;
      server.use(
        http.post('*/v1/ingest', async () => {
          attempts++;
          if (attempts < 2) {
            return HttpResponse.json({ error: 'internal' }, { status: 500 });
          }
          capturedLogs.push({ level: 'info', message: 'Will retry' });
          return HttpResponse.json({ accepted: 1 });
        }),
      );

      const client = new Logwell(defaultConfig);

      client.info('Will retry');
      await client.flush();

      // Should succeed on retry
      expect(attempts).toBeGreaterThanOrEqual(2);
    }, 10000);
  });

  describe('source location capture', () => {
    it('sends sourceFile and lineNumber when captureSourceLocation is enabled', async () => {
      const client = new Logwell({
        ...defaultConfig,
        captureSourceLocation: true,
      });

      client.info('Log with source location');
      await client.flush();

      expect(capturedLogs).toHaveLength(1);
      expect(capturedLogs[0].sourceFile).toBeDefined();
      expect(capturedLogs[0].sourceFile).toContain('client.integration.test.ts');
      expect(capturedLogs[0].lineNumber).toBeDefined();
      expect(typeof capturedLogs[0].lineNumber).toBe('number');
      expect(capturedLogs[0].lineNumber).toBeGreaterThan(0);
    });

    it('does not send sourceFile when captureSourceLocation is disabled', async () => {
      const client = new Logwell({
        ...defaultConfig,
        captureSourceLocation: false,
      });

      client.info('Log without source location');
      await client.flush();

      expect(capturedLogs).toHaveLength(1);
      expect(capturedLogs[0].sourceFile).toBeUndefined();
      expect(capturedLogs[0].lineNumber).toBeUndefined();
    });

    it('does not send sourceFile by default', async () => {
      const client = new Logwell(defaultConfig);

      client.info('Log with default config');
      await client.flush();

      expect(capturedLogs).toHaveLength(1);
      expect(capturedLogs[0].sourceFile).toBeUndefined();
      expect(capturedLogs[0].lineNumber).toBeUndefined();
    });
  });
});
