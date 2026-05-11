import { describe, expect, it } from 'vitest';
import { parseSimpleIngestRequest, SimpleIngestError } from './simple-ingest';

describe('parseSimpleIngestRequest', () => {
  const validEntry = { level: 'info', message: 'test message' };

  describe('input validation', () => {
    it('throws SimpleIngestError on null body', () => {
      expect(() => parseSimpleIngestRequest(null)).toThrow(SimpleIngestError);
      expect(() => parseSimpleIngestRequest(null)).toThrow('Request body cannot be empty');
    });

    it('throws SimpleIngestError on undefined body', () => {
      expect(() => parseSimpleIngestRequest(undefined)).toThrow(SimpleIngestError);
      expect(() => parseSimpleIngestRequest(undefined)).toThrow('Request body cannot be empty');
    });

    it('throws SimpleIngestError on empty array', () => {
      expect(() => parseSimpleIngestRequest([])).toThrow(SimpleIngestError);
      expect(() => parseSimpleIngestRequest([])).toThrow('Request body cannot be an empty array');
    });

    it('accepts single object and wraps in array', () => {
      const result = parseSimpleIngestRequest(validEntry);
      expect(result.accepted).toBe(1);
      expect(result.records).toHaveLength(1);
    });

    it('accepts array of objects', () => {
      const result = parseSimpleIngestRequest([validEntry, validEntry]);
      expect(result.accepted).toBe(2);
      expect(result.records).toHaveLength(2);
    });
  });

  describe('required fields', () => {
    it('rejects entry missing level', () => {
      const result = parseSimpleIngestRequest({ message: 'test' });
      expect(result.rejected).toBe(1);
      expect(result.errors[0]).toContain("missing required field 'level'");
    });

    it('rejects entry with invalid level', () => {
      const result = parseSimpleIngestRequest({ level: 'invalid', message: 'test' });
      expect(result.rejected).toBe(1);
      expect(result.errors[0]).toContain("invalid level 'invalid'");
      expect(result.errors[0]).toContain('must be one of');
    });

    it('rejects entry missing message', () => {
      const result = parseSimpleIngestRequest({ level: 'info' });
      expect(result.rejected).toBe(1);
      expect(result.errors[0]).toContain("missing required field 'message'");
    });

    it('rejects entry with non-string message', () => {
      const result = parseSimpleIngestRequest({ level: 'info', message: 123 });
      expect(result.rejected).toBe(1);
      expect(result.errors[0]).toContain('message must be a string');
    });

    it('rejects entry with empty message', () => {
      const result = parseSimpleIngestRequest({ level: 'info', message: '   ' });
      expect(result.rejected).toBe(1);
      expect(result.errors[0]).toContain('message cannot be empty');
    });

    it('rejects null entry', () => {
      const result = parseSimpleIngestRequest([null]);
      expect(result.rejected).toBe(1);
      expect(result.errors[0]).toContain('must be an object');
    });

    it('rejects string entry', () => {
      const result = parseSimpleIngestRequest(['not an object']);
      expect(result.rejected).toBe(1);
      expect(result.errors[0]).toContain('must be an object');
    });

    it('rejects number entry', () => {
      const result = parseSimpleIngestRequest([123]);
      expect(result.rejected).toBe(1);
      expect(result.errors[0]).toContain('must be an object');
    });
  });

  describe('valid log levels', () => {
    it.each(['debug', 'info', 'warn', 'error', 'fatal'] as const)('accepts level "%s"', (level) => {
      const result = parseSimpleIngestRequest({ level, message: 'test' });
      expect(result.accepted).toBe(1);
      expect(result.records[0].level).toBe(level);
    });
  });

  describe('optional fields', () => {
    describe('timestamp', () => {
      it('parses valid ISO8601 timestamp', () => {
        const timestamp = '2024-01-15T10:30:00Z';
        const result = parseSimpleIngestRequest({ ...validEntry, timestamp });
        expect(result.records[0].timestamp).toEqual(new Date(timestamp));
      });

      it('uses current date for invalid timestamp', () => {
        const before = Date.now();
        const result = parseSimpleIngestRequest({ ...validEntry, timestamp: 'invalid' });
        const after = Date.now();
        expect(result.records[0].timestamp.getTime()).toBeGreaterThanOrEqual(before);
        expect(result.records[0].timestamp.getTime()).toBeLessThanOrEqual(after);
      });

      it('uses current date for missing timestamp', () => {
        const before = Date.now();
        const result = parseSimpleIngestRequest(validEntry);
        const after = Date.now();
        expect(result.records[0].timestamp.getTime()).toBeGreaterThanOrEqual(before);
        expect(result.records[0].timestamp.getTime()).toBeLessThanOrEqual(after);
      });

      it('uses current date for non-string timestamp', () => {
        const before = Date.now();
        const result = parseSimpleIngestRequest({ ...validEntry, timestamp: 12345 });
        const after = Date.now();
        expect(result.records[0].timestamp.getTime()).toBeGreaterThanOrEqual(before);
        expect(result.records[0].timestamp.getTime()).toBeLessThanOrEqual(after);
      });
    });

    describe('service', () => {
      it('parses service name into resourceAttributes', () => {
        const result = parseSimpleIngestRequest({ ...validEntry, service: 'my-app' });
        expect(result.records[0].resourceAttributes).toEqual({ 'service.name': 'my-app' });
      });

      it('returns null resourceAttributes for missing service', () => {
        const result = parseSimpleIngestRequest(validEntry);
        expect(result.records[0].resourceAttributes).toBeNull();
      });

      it('returns null resourceAttributes for non-string service', () => {
        const result = parseSimpleIngestRequest({ ...validEntry, service: 123 });
        expect(result.records[0].resourceAttributes).toBeNull();
      });
    });

    describe('metadata', () => {
      it('parses metadata object', () => {
        const metadata = { foo: 'bar', nested: { a: 1 } };
        const result = parseSimpleIngestRequest({ ...validEntry, metadata });
        expect(result.records[0].metadata).toEqual(metadata);
      });

      it('returns null metadata for missing metadata', () => {
        const result = parseSimpleIngestRequest(validEntry);
        expect(result.records[0].metadata).toBeNull();
      });

      it('returns null metadata for non-object metadata', () => {
        const result = parseSimpleIngestRequest({ ...validEntry, metadata: 'string' });
        expect(result.records[0].metadata).toBeNull();
      });

      it('returns null metadata for null metadata', () => {
        const result = parseSimpleIngestRequest({ ...validEntry, metadata: null });
        expect(result.records[0].metadata).toBeNull();
      });
    });
  });

  describe('source location fields', () => {
    describe('sourceFile', () => {
      it('parses valid sourceFile', () => {
        const result = parseSimpleIngestRequest({ ...validEntry, sourceFile: '/app/index.ts' });
        expect(result.records[0].sourceFile).toBe('/app/index.ts');
      });

      it('returns null sourceFile for missing sourceFile', () => {
        const result = parseSimpleIngestRequest(validEntry);
        expect(result.records[0].sourceFile).toBeNull();
      });

      it('returns null sourceFile for non-string sourceFile', () => {
        const result = parseSimpleIngestRequest({ ...validEntry, sourceFile: 123 });
        expect(result.records[0].sourceFile).toBeNull();
      });

      it('returns null sourceFile for null sourceFile', () => {
        const result = parseSimpleIngestRequest({ ...validEntry, sourceFile: null });
        expect(result.records[0].sourceFile).toBeNull();
      });
    });

    describe('lineNumber', () => {
      it('parses valid lineNumber', () => {
        const result = parseSimpleIngestRequest({ ...validEntry, lineNumber: 42 });
        expect(result.records[0].lineNumber).toBe(42);
      });

      it('returns null lineNumber for missing lineNumber', () => {
        const result = parseSimpleIngestRequest(validEntry);
        expect(result.records[0].lineNumber).toBeNull();
      });

      it('returns null lineNumber for non-number lineNumber', () => {
        const result = parseSimpleIngestRequest({ ...validEntry, lineNumber: '42' });
        expect(result.records[0].lineNumber).toBeNull();
      });

      it('returns null lineNumber for zero', () => {
        const result = parseSimpleIngestRequest({ ...validEntry, lineNumber: 0 });
        expect(result.records[0].lineNumber).toBeNull();
      });

      it('returns null lineNumber for negative number', () => {
        const result = parseSimpleIngestRequest({ ...validEntry, lineNumber: -5 });
        expect(result.records[0].lineNumber).toBeNull();
      });

      it('returns null lineNumber for null', () => {
        const result = parseSimpleIngestRequest({ ...validEntry, lineNumber: null });
        expect(result.records[0].lineNumber).toBeNull();
      });
    });

    describe('combined', () => {
      it('parses both sourceFile and lineNumber together', () => {
        const result = parseSimpleIngestRequest({
          ...validEntry,
          sourceFile: '/app/utils.ts',
          lineNumber: 100,
        });
        expect(result.records[0].sourceFile).toBe('/app/utils.ts');
        expect(result.records[0].lineNumber).toBe(100);
      });
    });
  });

  describe('metadata extraction', () => {
    it('extracts requestId from metadata using OTLP attribute keys', () => {
      const result = parseSimpleIngestRequest({
        ...validEntry,
        metadata: { 'request.id': 'req-123' },
      });
      expect(result.records[0].requestId).toBe('req-123');
    });

    it('extracts userId from metadata using OTLP attribute keys', () => {
      const result = parseSimpleIngestRequest({
        ...validEntry,
        metadata: { 'enduser.id': 'user-456' },
      });
      expect(result.records[0].userId).toBe('user-456');
    });

    it('extracts ipAddress from metadata using OTLP attribute keys', () => {
      const result = parseSimpleIngestRequest({
        ...validEntry,
        metadata: { 'client.address': '192.168.1.1' },
      });
      expect(result.records[0].ipAddress).toBe('192.168.1.1');
    });

    it('falls back to alternate metadata keys', () => {
      const result = parseSimpleIngestRequest({
        ...validEntry,
        metadata: { request_id: 'req-789', user_id: 'user-999', ip_address: '10.0.0.1' },
      });
      expect(result.records[0].requestId).toBe('req-789');
      expect(result.records[0].userId).toBe('user-999');
      expect(result.records[0].ipAddress).toBe('10.0.0.1');
    });

    it('returns null for missing metadata fields', () => {
      const result = parseSimpleIngestRequest(validEntry);
      expect(result.records[0].requestId).toBeNull();
      expect(result.records[0].userId).toBeNull();
      expect(result.records[0].ipAddress).toBeNull();
    });

    it('returns null for empty metadata', () => {
      const result = parseSimpleIngestRequest({
        ...validEntry,
        metadata: {},
      });
      expect(result.records[0].requestId).toBeNull();
      expect(result.records[0].userId).toBeNull();
      expect(result.records[0].ipAddress).toBeNull();
    });
  });

  describe('batch processing', () => {
    it('correctly counts accepted and rejected', () => {
      const entries = [
        validEntry,
        { level: 'invalid', message: 'bad' },
        { level: 'debug', message: 'good' },
        { message: 'missing level' },
      ];
      const result = parseSimpleIngestRequest(entries);
      expect(result.accepted).toBe(2);
      expect(result.rejected).toBe(2);
      expect(result.accepted + result.rejected).toBe(entries.length);
    });

    it('collects all errors', () => {
      const entries = [
        { level: 'invalid', message: 'bad' },
        { message: 'missing level' },
        { level: 'info' },
      ];
      const result = parseSimpleIngestRequest(entries);
      expect(result.errors).toHaveLength(3);
    });

    it('processes valid entries despite errors in batch', () => {
      const entries = [
        validEntry,
        { level: 'invalid', message: 'bad' },
        { level: 'debug', message: 'good' },
      ];
      const result = parseSimpleIngestRequest(entries);
      expect(result.records).toHaveLength(2);
      expect(result.records[0].message).toBe('test message');
      expect(result.records[1].message).toBe('good');
    });

    it('includes index in error messages', () => {
      const entries = [validEntry, validEntry, { level: 'invalid', message: 'bad' }];
      const result = parseSimpleIngestRequest(entries);
      expect(result.errors[0]).toContain('index 2');
    });
  });
});

describe('SimpleIngestError', () => {
  it('has correct name', () => {
    const error = new SimpleIngestError('test message');
    expect(error.name).toBe('SimpleIngestError');
  });

  it('has correct message', () => {
    const error = new SimpleIngestError('test message');
    expect(error.message).toBe('test message');
  });

  it('is instance of Error', () => {
    const error = new SimpleIngestError('test');
    expect(error).toBeInstanceOf(Error);
  });

  it('is instance of SimpleIngestError', () => {
    const error = new SimpleIngestError('test');
    expect(error).toBeInstanceOf(SimpleIngestError);
  });
});
