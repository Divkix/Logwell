import { describe, expect, it } from 'vitest';
import {
  normalizeOtlpLogsRequest,
  normalizeSpanId,
  normalizeTraceId,
  parseOtlpAnyValue,
  parseUint64String,
  severityNumberToLogLevel,
} from './otlp';

describe('normalizeOtlpLogsRequest', () => {
  it('flattens resource/scope/log records and derives display fields', () => {
    const payload = {
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'api' } },
              { key: 'service.version', value: { stringValue: '1.0.0' } },
            ],
            droppedAttributesCount: 1,
          },
          schemaUrl: 'https://opentelemetry.io/schemas/1.0.0',
          scopeLogs: [
            {
              scope: {
                name: 'logger',
                version: '2.1.0',
                attributes: [{ key: 'scope.attr', value: { boolValue: true } }],
                droppedAttributesCount: 0,
              },
              schemaUrl: 'https://example.com/scope/1.0.0',
              logRecords: [
                {
                  timeUnixNano: '1700000000000000000',
                  observedTimeUnixNano: '1700000000001000000',
                  severityNumber: 17,
                  severityText: 'ERROR',
                  body: { stringValue: 'Database failed' },
                  attributes: [{ key: 'request.id', value: { stringValue: 'req-123' } }],
                  droppedAttributesCount: 0,
                  flags: 1,
                  traceId: '5B8EFFF798038103D269B633813FC60C',
                  spanId: 'EEE19B7EC3C1B174',
                },
              ],
            },
          ],
        },
      ],
    };

    const { records } = normalizeOtlpLogsRequest(payload);
    expect(records).toHaveLength(1);
    const record = records[0];

    expect(record.resourceAttributes).toEqual({
      'service.name': 'api',
      'service.version': '1.0.0',
    });
    expect(record.resourceDroppedAttributesCount).toBe(1);
    expect(record.resourceSchemaUrl).toBe('https://opentelemetry.io/schemas/1.0.0');
    expect(record.scopeName).toBe('logger');
    expect(record.scopeVersion).toBe('2.1.0');
    expect(record.scopeAttributes).toEqual({ 'scope.attr': true });
    expect(record.scopeSchemaUrl).toBe('https://example.com/scope/1.0.0');
    expect(record.attributes).toEqual({ 'request.id': 'req-123' });
    expect(record.message).toBe('Database failed');
    expect(record.level).toBe('error');
    expect(record.timestamp.toISOString()).toBe(new Date(1700000000000).toISOString());
    expect(record.traceId).toBe('5b8efff798038103d269b633813fc60c');
    expect(record.spanId).toBe('eee19b7ec3c1b174');
  });

  it('stringifies non-string bodies for message fallback', () => {
    const payload = {
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                {
                  timeUnixNano: '1700000000000000000',
                  body: {
                    kvlistValue: {
                      values: [
                        { key: 'action', value: { stringValue: 'login' } },
                        { key: 'success', value: { boolValue: true } },
                      ],
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    const { records } = normalizeOtlpLogsRequest(payload);
    expect(records).toHaveLength(1);
    expect(records[0].message).toBe('{"action":"login","success":true}');
  });
});

describe('parseOtlpAnyValue', () => {
  it('parses primitive values', () => {
    expect(parseOtlpAnyValue({ stringValue: 'hello' })).toBe('hello');
    expect(parseOtlpAnyValue({ boolValue: true })).toBe(true);
    expect(parseOtlpAnyValue({ intValue: '42' })).toBe(42);
    expect(parseOtlpAnyValue({ doubleValue: 3.14 })).toBe(3.14);
  });

  it('preserves large int64 values as strings', () => {
    expect(parseOtlpAnyValue({ intValue: '9007199254740993' })).toBe('9007199254740993');
  });

  it('parses array and kvlist values', () => {
    expect(
      parseOtlpAnyValue({
        arrayValue: { values: [{ stringValue: 'a' }, { intValue: 2 }] },
      }),
    ).toEqual(['a', 2]);

    expect(
      parseOtlpAnyValue({
        kvlistValue: {
          values: [{ key: 'foo', value: { stringValue: 'bar' } }],
        },
      }),
    ).toEqual({ foo: 'bar' });
  });
});

describe('severityNumberToLogLevel', () => {
  it('maps severity ranges to log levels', () => {
    expect(severityNumberToLogLevel(1)).toBe('debug');
    expect(severityNumberToLogLevel(6)).toBe('debug');
    expect(severityNumberToLogLevel(9)).toBe('info');
    expect(severityNumberToLogLevel(14)).toBe('warn');
    expect(severityNumberToLogLevel(18)).toBe('error');
    expect(severityNumberToLogLevel(21)).toBe('fatal');
  });
});

describe('parseUint64String', () => {
  it('accepts valid non-negative integer strings', () => {
    expect(parseUint64String('0')).toBe('0');
    expect(parseUint64String('1700000000000000000')).toBe('1700000000000000000');
    expect(parseUint64String('  42  ')).toBe('42');
  });

  it('rejects negative string values', () => {
    expect(parseUint64String('-1')).toBeNull();
    expect(parseUint64String('-1000000')).toBeNull();
    expect(parseUint64String('  -42  ')).toBeNull();
  });

  it('rejects negative number values', () => {
    expect(parseUint64String(-1)).toBeNull();
    expect(parseUint64String(-1000000)).toBeNull();
  });

  it('rejects non-integer number values', () => {
    expect(parseUint64String(1.5)).toBeNull();
    expect(parseUint64String(-1.5)).toBeNull();
  });

  it('rejects non-numeric strings', () => {
    expect(parseUint64String('abc')).toBeNull();
    expect(parseUint64String('1.5')).toBeNull();
    expect(parseUint64String('')).toBeNull();
    expect(parseUint64String(' ')).toBeNull();
  });

  it('accepts non-negative integer numbers', () => {
    expect(parseUint64String(0)).toBe('0');
    expect(parseUint64String(42)).toBe('42');
  });
});

describe('normalizeOtlpLogsRequest edge cases', () => {
  it('rejects negative timeUnixNano and falls back to current timestamp', () => {
    const payload = {
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                {
                  timeUnixNano: '-1000000',
                },
              ],
            },
          ],
        },
      ],
    };

    const { records } = normalizeOtlpLogsRequest(payload);
    expect(records).toHaveLength(1);
    expect(records[0].timeUnixNano).toBeNull();
    const now = new Date();
    expect(records[0].timestamp.getTime()).toBeGreaterThanOrEqual(now.getTime() - 5000);
    expect(records[0].timestamp.getTime()).toBeLessThanOrEqual(now.getTime() + 5000);
  });

  it('rejects negative observedTimeUnixNano and falls back to current timestamp', () => {
    const payload = {
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                {
                  observedTimeUnixNano: '-1000000',
                },
              ],
            },
          ],
        },
      ],
    };

    const { records } = normalizeOtlpLogsRequest(payload);
    expect(records).toHaveLength(1);
    expect(records[0].observedTimeUnixNano).toBeNull();
    const now = new Date();
    expect(records[0].timestamp.getTime()).toBeGreaterThanOrEqual(now.getTime() - 5000);
    expect(records[0].timestamp.getTime()).toBeLessThanOrEqual(now.getTime() + 5000);
  });

  it('normalizes empty attributes to null', () => {
    const payload = {
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                {
                  timeUnixNano: '1700000000000000000',
                  attributes: [],
                },
              ],
            },
          ],
        },
      ],
    };

    const { records } = normalizeOtlpLogsRequest(payload);
    expect(records).toHaveLength(1);
    expect(records[0].attributes).toBeNull();
  });

  it('handles extremely large timeUnixNano without producing Invalid Date', () => {
    const payload = {
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                {
                  timeUnixNano: '999999999999999999999999999999',
                },
              ],
            },
          ],
        },
      ],
    };

    const { records } = normalizeOtlpLogsRequest(payload);
    expect(records).toHaveLength(1);
    expect(records[0].timeUnixNano).toBe('999999999999999999999999999999');
    expect(Number.isNaN(records[0].timestamp.getTime())).toBe(false);
    const now = new Date();
    expect(records[0].timestamp.getTime()).toBeGreaterThanOrEqual(now.getTime() - 5000);
    expect(records[0].timestamp.getTime()).toBeLessThanOrEqual(now.getTime() + 5000);
  });
});

describe('normalizeTraceId/normalizeSpanId', () => {
  it('normalizes valid hex ids and rejects invalid ones', () => {
    expect(normalizeTraceId('5B8EFFF798038103D269B633813FC60C')).toBe(
      '5b8efff798038103d269b633813fc60c',
    );
    expect(normalizeTraceId('invalid')).toBeNull();
    expect(normalizeSpanId('EEE19B7EC3C1B174')).toBe('eee19b7ec3c1b174');
    expect(normalizeSpanId('1234')).toBeNull();
  });
});
