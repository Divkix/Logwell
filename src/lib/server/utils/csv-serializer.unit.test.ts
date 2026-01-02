import { describe, expect, test } from 'vitest';
import type { ExportableLog } from '$lib/types/export';
import { escapeCSVField, serializeToCsv } from './csv-serializer';

describe('escapeCSVField', () => {
  test('returns empty string for null or undefined', () => {
    expect(escapeCSVField(null)).toBe('');
    expect(escapeCSVField(undefined)).toBe('');
  });

  test('converts numbers to strings', () => {
    expect(escapeCSVField(42)).toBe('42');
    expect(escapeCSVField(3.14)).toBe('3.14');
  });

  test('handles plain text without special characters', () => {
    expect(escapeCSVField('simple text')).toBe('simple text');
  });

  test('wraps fields with commas in quotes', () => {
    expect(escapeCSVField('hello, world')).toBe('"hello, world"');
  });

  test('escapes double quotes by doubling them', () => {
    expect(escapeCSVField('say "hello"')).toBe('"say ""hello"""');
  });

  test('wraps fields with newlines in quotes', () => {
    expect(escapeCSVField('line1\nline2')).toBe('"line1\nline2"');
  });

  test('handles combination of comma and quotes', () => {
    expect(escapeCSVField('error: "value", unexpected')).toBe('"error: ""value"", unexpected"');
  });

  test('handles empty strings', () => {
    expect(escapeCSVField('')).toBe('');
  });
});

describe('serializeToCsv', () => {
  test('returns only headers for empty array', () => {
    const result = serializeToCsv([]);
    expect(result).toBe(
      'id,timestamp,level,message,metadata,sourceFile,lineNumber,requestId,userId,ipAddress\n',
    );
  });

  test('serializes single log entry', () => {
    const logs: ExportableLog[] = [
      {
        id: 'log-1',
        timestamp: '2026-01-03T10:00:00Z',
        level: 'info',
        message: 'Test message',
        metadata: null,
        sourceFile: null,
        lineNumber: null,
        requestId: null,
        userId: null,
        ipAddress: null,
      },
    ];

    const result = serializeToCsv(logs);
    const lines = result.split('\n');

    expect(lines[0]).toBe(
      'id,timestamp,level,message,metadata,sourceFile,lineNumber,requestId,userId,ipAddress',
    );
    expect(lines[1]).toBe('log-1,2026-01-03T10:00:00Z,info,Test message,,,,,,');
  });

  test('serializes multiple log entries', () => {
    const logs: ExportableLog[] = [
      {
        id: 'log-1',
        timestamp: '2026-01-03T10:00:00Z',
        level: 'info',
        message: 'First message',
        metadata: null,
        sourceFile: null,
        lineNumber: null,
        requestId: null,
        userId: null,
        ipAddress: null,
      },
      {
        id: 'log-2',
        timestamp: '2026-01-03T10:01:00Z',
        level: 'error',
        message: 'Second message',
        metadata: null,
        sourceFile: null,
        lineNumber: null,
        requestId: null,
        userId: null,
        ipAddress: null,
      },
    ];

    const result = serializeToCsv(logs);
    const lines = result.split('\n');

    expect(lines).toHaveLength(4); // header + 2 logs + trailing newline
    expect(lines[1]).toContain('log-1');
    expect(lines[2]).toContain('log-2');
  });

  test('handles metadata as JSON string', () => {
    const logs: ExportableLog[] = [
      {
        id: 'log-1',
        timestamp: '2026-01-03T10:00:00Z',
        level: 'info',
        message: 'Test',
        metadata: '{"key":"value","count":42}',
        sourceFile: null,
        lineNumber: null,
        requestId: null,
        userId: null,
        ipAddress: null,
      },
    ];

    const result = serializeToCsv(logs);
    expect(result).toContain('"{""key"":""value"",""count"":42}"');
  });

  test('handles messages with commas', () => {
    const logs: ExportableLog[] = [
      {
        id: 'log-1',
        timestamp: '2026-01-03T10:00:00Z',
        level: 'info',
        message: 'Error occurred, check logs, fix immediately',
        metadata: null,
        sourceFile: null,
        lineNumber: null,
        requestId: null,
        userId: null,
        ipAddress: null,
      },
    ];

    const result = serializeToCsv(logs);
    expect(result).toContain('"Error occurred, check logs, fix immediately"');
  });

  test('handles messages with quotes', () => {
    const logs: ExportableLog[] = [
      {
        id: 'log-1',
        timestamp: '2026-01-03T10:00:00Z',
        level: 'error',
        message: 'Unexpected "token" found',
        metadata: null,
        sourceFile: null,
        lineNumber: null,
        requestId: null,
        userId: null,
        ipAddress: null,
      },
    ];

    const result = serializeToCsv(logs);
    expect(result).toContain('"Unexpected ""token"" found"');
  });

  test('handles newlines in messages', () => {
    const logs: ExportableLog[] = [
      {
        id: 'log-1',
        timestamp: '2026-01-03T10:00:00Z',
        level: 'error',
        message: 'Stack trace:\nline 1\nline 2',
        metadata: null,
        sourceFile: null,
        lineNumber: null,
        requestId: null,
        userId: null,
        ipAddress: null,
      },
    ];

    const result = serializeToCsv(logs);
    expect(result).toContain('"Stack trace:\nline 1\nline 2"');
  });

  test('handles all fields populated', () => {
    const logs: ExportableLog[] = [
      {
        id: 'log-1',
        timestamp: '2026-01-03T10:00:00Z',
        level: 'warn',
        message: 'Warning message',
        metadata: '{"context":"test"}',
        sourceFile: '/app/server.ts',
        lineNumber: 42,
        requestId: 'req-123',
        userId: 'user-456',
        ipAddress: '192.168.1.1',
      },
    ];

    const result = serializeToCsv(logs);
    const lines = result.split('\n');

    expect(lines[1]).toBe(
      'log-1,2026-01-03T10:00:00Z,warn,Warning message,"{""context"":""test""}",/app/server.ts,42,req-123,user-456,192.168.1.1',
    );
  });

  test('handles null and undefined fields gracefully', () => {
    const logs: ExportableLog[] = [
      {
        id: 'log-1',
        timestamp: '2026-01-03T10:00:00Z',
        level: 'info',
        message: 'Test',
        metadata: null,
        sourceFile: null,
        lineNumber: null,
        requestId: null,
        userId: null,
        ipAddress: null,
      },
    ];

    const result = serializeToCsv(logs);
    expect(result).toContain('log-1,2026-01-03T10:00:00Z,info,Test,,,,,,');
  });

  test('handles lineNumber as number field', () => {
    const logs: ExportableLog[] = [
      {
        id: 'log-1',
        timestamp: '2026-01-03T10:00:00Z',
        level: 'info',
        message: 'Test',
        metadata: null,
        sourceFile: 'test.ts',
        lineNumber: 123,
        requestId: null,
        userId: null,
        ipAddress: null,
      },
    ];

    const result = serializeToCsv(logs);
    expect(result).toContain(',test.ts,123,');
  });
});
