import { describe, expect, it } from "vite-plus/test";
import { bucketTimestamps, fillMissingBuckets, getTimeBucketConfig } from "./timeseries";

describe("getTimeBucketConfig", () => {
  it.each([
    ["15m", 60 * 1000, 15],
    ["1h", 5 * 60 * 1000, 12],
    ["24h", 60 * 60 * 1000, 24],
    ["7d", 6 * 60 * 60 * 1000, 28],
  ])("returns %sms interval for %s range (%s buckets)", (range, intervalMs, expectedBuckets) => {
    const config = getTimeBucketConfig(range as "15m");
    expect(config.intervalMs).toBe(intervalMs);
    expect(config.expectedBuckets).toBe(expectedBuckets);
  });
});

describe("bucketTimestamps", () => {
  it("groups timestamps into correct buckets", () => {
    const rangeStart = new Date("2024-01-15T10:00:00.000Z");
    const config = { intervalMs: 60 * 60 * 1000, expectedBuckets: 24 };

    const timestamps = [
      new Date("2024-01-15T10:15:00.000Z"),
      new Date("2024-01-15T10:45:00.000Z"),
      new Date("2024-01-15T11:30:00.000Z"),
    ];

    const buckets = bucketTimestamps(timestamps, config, rangeStart);

    expect(buckets[0]).toBe(2);
    expect(buckets[1]).toBe(1);
  });

  it("handles timestamps exactly on bucket boundaries", () => {
    const rangeStart = new Date("2024-01-15T10:00:00.000Z");
    const config = { intervalMs: 60 * 60 * 1000, expectedBuckets: 24 };

    const timestamps = [new Date("2024-01-15T10:00:00.000Z"), new Date("2024-01-15T11:00:00.000Z")];

    const buckets = bucketTimestamps(timestamps, config, rangeStart);

    expect(buckets[0]).toBe(1);
    expect(buckets[1]).toBe(1);
  });

  it("returns empty object for empty input", () => {
    const rangeStart = new Date("2024-01-15T10:00:00.000Z");
    const config = { intervalMs: 60 * 60 * 1000, expectedBuckets: 24 };

    const buckets = bucketTimestamps([], config, rangeStart);

    expect(buckets).toEqual({});
  });

  it("ignores timestamps outside the expected bucket range", () => {
    const rangeStart = new Date("2024-01-15T10:00:00.000Z");
    const config = { intervalMs: 60 * 60 * 1000, expectedBuckets: 3 };

    const timestamps = [
      new Date("2024-01-15T09:00:00.000Z"),
      new Date("2024-01-15T10:30:00.000Z"),
      new Date("2024-01-15T15:00:00.000Z"),
    ];

    const buckets = bucketTimestamps(timestamps, config, rangeStart);

    expect(buckets[0]).toBe(1);
    expect(buckets[-1]).toBeUndefined();
    expect(buckets[5]).toBeUndefined();
  });
});

describe("fillMissingBuckets", () => {
  it("fills gaps between buckets with zero count", () => {
    const rangeStart = new Date("2024-01-15T10:00:00.000Z");
    const rangeEnd = new Date("2024-01-15T13:00:00.000Z");
    const config = { intervalMs: 60 * 60 * 1000, expectedBuckets: 3 };

    const bucketCounts = { 0: 5, 2: 3 };

    const result = fillMissingBuckets(bucketCounts, config, rangeStart, rangeEnd);

    expect(result).toHaveLength(3);
    expect(result[0]!.count).toBe(5);
    expect(result[1]!.count).toBe(0);
    expect(result[2]!.count).toBe(3);
  });

  it("generates all buckets for completely empty input", () => {
    const rangeStart = new Date("2024-01-15T10:00:00.000Z");
    const rangeEnd = new Date("2024-01-15T13:00:00.000Z");
    const config = { intervalMs: 60 * 60 * 1000, expectedBuckets: 3 };

    const result = fillMissingBuckets({}, config, rangeStart, rangeEnd);

    expect(result).toHaveLength(3);
    expect(result.every((b) => b.count === 0)).toBe(true);
  });

  it("preserves existing bucket counts", () => {
    const rangeStart = new Date("2024-01-15T10:00:00.000Z");
    const rangeEnd = new Date("2024-01-15T12:00:00.000Z");
    const config = { intervalMs: 60 * 60 * 1000, expectedBuckets: 2 };

    const bucketCounts = { 0: 10, 1: 20 };

    const result = fillMissingBuckets(bucketCounts, config, rangeStart, rangeEnd);

    expect(result[0]!.count).toBe(10);
    expect(result[1]!.count).toBe(20);
  });

  it("returns buckets with valid ISO timestamps", () => {
    const rangeStart = new Date("2024-01-15T10:00:00.000Z");
    const rangeEnd = new Date("2024-01-15T12:00:00.000Z");
    const config = { intervalMs: 60 * 60 * 1000, expectedBuckets: 2 };

    const result = fillMissingBuckets({}, config, rangeStart, rangeEnd);

    expect(result[0]!.timestamp).toBe("2024-01-15T10:00:00.000Z");
    expect(result[1]!.timestamp).toBe("2024-01-15T11:00:00.000Z");
  });
});
