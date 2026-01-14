import { describe, expect, it } from 'vitest';
import {
  bucketTimestamps,
  fillMissingBuckets,
  formatBucketLabel,
  getTimeBucketConfig,
} from './timeseries';

describe('getTimeBucketConfig', () => {
  it('returns 60000ms interval for 15m range', () => {
    const config = getTimeBucketConfig('15m');
    expect(config.intervalMs).toBe(60 * 1000);
    expect(config.expectedBuckets).toBe(15);
  });

  it('returns 300000ms interval for 1h range', () => {
    const config = getTimeBucketConfig('1h');
    expect(config.intervalMs).toBe(5 * 60 * 1000);
    expect(config.expectedBuckets).toBe(12);
  });

  it('returns 3600000ms interval for 24h range', () => {
    const config = getTimeBucketConfig('24h');
    expect(config.intervalMs).toBe(60 * 60 * 1000);
    expect(config.expectedBuckets).toBe(24);
  });

  it('returns 21600000ms interval for 7d range', () => {
    const config = getTimeBucketConfig('7d');
    expect(config.intervalMs).toBe(6 * 60 * 60 * 1000);
    expect(config.expectedBuckets).toBe(28);
  });
});

describe('bucketTimestamps', () => {
  it('groups timestamps into correct buckets', () => {
    const rangeStart = new Date('2024-01-15T10:00:00.000Z');
    const config = { intervalMs: 60 * 60 * 1000, expectedBuckets: 24 }; // 1 hour buckets

    const timestamps = [
      new Date('2024-01-15T10:15:00.000Z'), // bucket 0
      new Date('2024-01-15T10:45:00.000Z'), // bucket 0
      new Date('2024-01-15T11:30:00.000Z'), // bucket 1
    ];

    const buckets = bucketTimestamps(timestamps, config, rangeStart);

    expect(buckets[0]).toBe(2); // Two logs in first hour
    expect(buckets[1]).toBe(1); // One log in second hour
  });

  it('handles timestamps exactly on bucket boundaries', () => {
    const rangeStart = new Date('2024-01-15T10:00:00.000Z');
    const config = { intervalMs: 60 * 60 * 1000, expectedBuckets: 24 };

    const timestamps = [
      new Date('2024-01-15T10:00:00.000Z'), // exactly on boundary
      new Date('2024-01-15T11:00:00.000Z'), // exactly on next boundary
    ];

    const buckets = bucketTimestamps(timestamps, config, rangeStart);

    expect(buckets[0]).toBe(1);
    expect(buckets[1]).toBe(1);
  });

  it('returns empty object for empty input', () => {
    const rangeStart = new Date('2024-01-15T10:00:00.000Z');
    const config = { intervalMs: 60 * 60 * 1000, expectedBuckets: 24 };

    const buckets = bucketTimestamps([], config, rangeStart);

    expect(buckets).toEqual({});
  });

  it('ignores timestamps outside the expected bucket range', () => {
    const rangeStart = new Date('2024-01-15T10:00:00.000Z');
    const config = { intervalMs: 60 * 60 * 1000, expectedBuckets: 3 }; // Only 3 buckets

    const timestamps = [
      new Date('2024-01-15T09:00:00.000Z'), // before range (bucket -1)
      new Date('2024-01-15T10:30:00.000Z'), // bucket 0
      new Date('2024-01-15T15:00:00.000Z'), // bucket 5 (beyond expectedBuckets)
    ];

    const buckets = bucketTimestamps(timestamps, config, rangeStart);

    expect(buckets[0]).toBe(1);
    expect(buckets[-1]).toBeUndefined();
    expect(buckets[5]).toBeUndefined();
  });
});

describe('fillMissingBuckets', () => {
  it('fills gaps between buckets with zero count', () => {
    const rangeStart = new Date('2024-01-15T10:00:00.000Z');
    const rangeEnd = new Date('2024-01-15T13:00:00.000Z');
    const config = { intervalMs: 60 * 60 * 1000, expectedBuckets: 3 };

    // Only bucket 0 and 2 have data
    const bucketCounts = { 0: 5, 2: 3 };

    const result = fillMissingBuckets(bucketCounts, config, rangeStart, rangeEnd);

    expect(result).toHaveLength(3);
    expect(result[0].count).toBe(5);
    expect(result[1].count).toBe(0); // filled with zero
    expect(result[2].count).toBe(3);
  });

  it('generates all buckets for completely empty input', () => {
    const rangeStart = new Date('2024-01-15T10:00:00.000Z');
    const rangeEnd = new Date('2024-01-15T13:00:00.000Z');
    const config = { intervalMs: 60 * 60 * 1000, expectedBuckets: 3 };

    const result = fillMissingBuckets({}, config, rangeStart, rangeEnd);

    expect(result).toHaveLength(3);
    expect(result.every((b) => b.count === 0)).toBe(true);
  });

  it('preserves existing bucket counts', () => {
    const rangeStart = new Date('2024-01-15T10:00:00.000Z');
    const rangeEnd = new Date('2024-01-15T12:00:00.000Z');
    const config = { intervalMs: 60 * 60 * 1000, expectedBuckets: 2 };

    const bucketCounts = { 0: 10, 1: 20 };

    const result = fillMissingBuckets(bucketCounts, config, rangeStart, rangeEnd);

    expect(result[0].count).toBe(10);
    expect(result[1].count).toBe(20);
  });

  it('returns buckets with valid ISO timestamps', () => {
    const rangeStart = new Date('2024-01-15T10:00:00.000Z');
    const rangeEnd = new Date('2024-01-15T12:00:00.000Z');
    const config = { intervalMs: 60 * 60 * 1000, expectedBuckets: 2 };

    const result = fillMissingBuckets({}, config, rangeStart, rangeEnd);

    expect(result[0].timestamp).toBe('2024-01-15T10:00:00.000Z');
    expect(result[1].timestamp).toBe('2024-01-15T11:00:00.000Z');
  });
});

describe('formatBucketLabel', () => {
  it('formats minute bucket as HH:mm', () => {
    const date = new Date('2024-01-15T14:35:00.000Z');
    expect(formatBucketLabel(date, '15m')).toBe('14:35');
    expect(formatBucketLabel(date, '1h')).toBe('14:35');
  });

  it('formats hour bucket as HH:00', () => {
    const date = new Date('2024-01-15T14:00:00.000Z');
    expect(formatBucketLabel(date, '24h')).toBe('14:00');
  });

  it('formats 6-hour bucket as MMM DD HH:00', () => {
    const date = new Date('2024-01-15T18:00:00.000Z');
    expect(formatBucketLabel(date, '7d')).toBe('Jan 15 18:00');
  });

  it('handles single-digit day correctly', () => {
    const date = new Date('2024-01-05T06:00:00.000Z');
    expect(formatBucketLabel(date, '7d')).toBe('Jan 5 06:00');
  });

  it('handles midnight correctly', () => {
    const date = new Date('2024-01-15T00:00:00.000Z');
    expect(formatBucketLabel(date, '24h')).toBe('00:00');
  });
});
