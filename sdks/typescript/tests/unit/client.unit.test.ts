import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logwell } from '../../src/client';
import type { LogEntry, LogwellConfig } from '../../src/types';
import { validConfigs } from '../fixtures/configs';

describe('Logwell Client - Source Location', () => {
  let defaultConfig: LogwellConfig;

  beforeEach(() => {
    vi.useFakeTimers();
    defaultConfig = {
      ...validConfigs.minimal,
      batchSize: 100, // High to prevent auto-flush
      flushInterval: 60000, // Long interval to prevent auto-flush
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('source location disabled (default)', () => {
    it('does not include sourceFile when captureSourceLocation is false', () => {
      const client = new Logwell(defaultConfig);
      const queueAddSpy = vi.spyOn(client['queue'], 'add');

      client.info('Test message');

      expect(queueAddSpy).toHaveBeenCalledTimes(1);
      const entry = queueAddSpy.mock.calls[0][0] as LogEntry;
      expect(entry.sourceFile).toBeUndefined();
      expect(entry.lineNumber).toBeUndefined();
    });

    it('does not include sourceFile by default', () => {
      const client = new Logwell(validConfigs.minimal);
      const queueAddSpy = vi.spyOn(client['queue'], 'add');

      client.info('Test message');

      const entry = queueAddSpy.mock.calls[0][0] as LogEntry;
      expect(entry.sourceFile).toBeUndefined();
      expect(entry.lineNumber).toBeUndefined();
    });
  });

  describe('source location enabled', () => {
    it('includes sourceFile when captureSourceLocation is true', () => {
      const client = new Logwell({
        ...defaultConfig,
        captureSourceLocation: true,
      });
      const queueAddSpy = vi.spyOn(client['queue'], 'add');

      client.info('Test message');

      const entry = queueAddSpy.mock.calls[0][0] as LogEntry;
      expect(entry.sourceFile).toBeDefined();
      expect(entry.sourceFile).toContain('client.unit.test.ts');
    });

    it('includes lineNumber when captureSourceLocation is true', () => {
      const client = new Logwell({
        ...defaultConfig,
        captureSourceLocation: true,
      });
      const queueAddSpy = vi.spyOn(client['queue'], 'add');

      client.info('Test message');

      const entry = queueAddSpy.mock.calls[0][0] as LogEntry;
      expect(entry.lineNumber).toBeDefined();
      expect(typeof entry.lineNumber).toBe('number');
      expect(entry.lineNumber).toBeGreaterThan(0);
    });

    it('captures correct location for info()', () => {
      const client = new Logwell({
        ...defaultConfig,
        captureSourceLocation: true,
      });
      const queueAddSpy = vi.spyOn(client['queue'], 'add');

      client.info('Test message'); // This line's number should be captured

      const entry = queueAddSpy.mock.calls[0][0] as LogEntry;
      expect(entry.sourceFile).not.toContain('client.ts');
      expect(entry.sourceFile).toContain('client.unit.test.ts');
    });

    it('captures correct location for log()', () => {
      const client = new Logwell({
        ...defaultConfig,
        captureSourceLocation: true,
      });
      const queueAddSpy = vi.spyOn(client['queue'], 'add');

      client.log({ level: 'info', message: 'Direct log' });

      const entry = queueAddSpy.mock.calls[0][0] as LogEntry;
      expect(entry.sourceFile).not.toContain('client.ts');
      expect(entry.sourceFile).toContain('client.unit.test.ts');
    });

    it.each([
      'debug',
      'info',
      'warn',
      'error',
      'fatal',
    ] as const)('captures correct location for %s()', (method) => {
      const client = new Logwell({
        ...defaultConfig,
        captureSourceLocation: true,
      });
      const queueAddSpy = vi.spyOn(client['queue'], 'add');

      client[method]('Test message');

      const entry = queueAddSpy.mock.calls[0][0] as LogEntry;
      expect(entry.sourceFile).toContain('client.unit.test.ts');
      expect(entry.lineNumber).toBeGreaterThan(0);
    });
  });

  describe('child logger', () => {
    it('child logger inherits captureSourceLocation setting', () => {
      const client = new Logwell({
        ...defaultConfig,
        captureSourceLocation: true,
      });
      const child = client.child({ metadata: { requestId: '123' } });
      const queueAddSpy = vi.spyOn(client['queue'], 'add');

      child.info('Child message');

      const entry = queueAddSpy.mock.calls[0][0] as LogEntry;
      expect(entry.sourceFile).toBeDefined();
      expect(entry.sourceFile).toContain('client.unit.test.ts');
    });

    it('child logger does not include source location when parent has it disabled', () => {
      const client = new Logwell({
        ...defaultConfig,
        captureSourceLocation: false,
      });
      const child = client.child({ metadata: { requestId: '123' } });
      const queueAddSpy = vi.spyOn(client['queue'], 'add');

      child.info('Child message');

      const entry = queueAddSpy.mock.calls[0][0] as LogEntry;
      expect(entry.sourceFile).toBeUndefined();
      expect(entry.lineNumber).toBeUndefined();
    });
  });
});
