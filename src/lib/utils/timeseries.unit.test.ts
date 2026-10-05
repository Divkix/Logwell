import { describe, expect, it } from "vite-plus/test";
import type { TimeRange } from "./time-range";
import { fillMissingBuckets, getTimeBucketConfig } from "./timeseries";

describe("getTimeBucketConfig", () => {
  it.each<[TimeRange, number, number]>([
    ["15m", 60 * 1000, 15],
    ["1h", 5 * 60 * 1000, 12],
    ["24h", 60 * 60 * 1000, 24],
    ["7d", 6 * 60 * 60 * 1000, 28],
  ])("returns %sms interval for %s range (%s buckets)", (range, intervalMs, expectedBuckets) => {
    const config = getTimeBucketConfig(range);
    expect(config.intervalMs).toBe(intervalMs);
    expect(config.expectedBuckets).toBe(expectedBuckets);
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

  it("preserves existing bucket counts", () => {
    const rangeStart = new Date("2024-01-15T10:00:00.000Z");
    const rangeEnd = new Date("2024-01-15T12:00:00.000Z");
    const config = { intervalMs: 60 * 60 * 1000, expectedBuckets: 2 };

    const bucketCounts = { 0: 10, 1: 20 };

    const result = fillMissingBuckets(bucketCounts, config, rangeStart, rangeEnd);

    expect(result[0]!.count).toBe(10);
    expect(result[1]!.count).toBe(20);
  });
});
