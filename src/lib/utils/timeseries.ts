import type { TimeRange } from "$lib/utils/time-range";

export interface TimeBucketConfig {
  intervalMs: number;
  expectedBuckets: number;
}

export interface TimeSeriesBucket {
  timestamp: string;
  count: number;
}

export function getTimeBucketConfig(range: TimeRange): TimeBucketConfig {
  switch (range) {
    case "15m":
      return { intervalMs: 60 * 1000, expectedBuckets: 15 };
    case "1h":
      return { intervalMs: 5 * 60 * 1000, expectedBuckets: 12 };
    case "24h":
      return { intervalMs: 60 * 60 * 1000, expectedBuckets: 24 };
    case "7d":
      return { intervalMs: 6 * 60 * 60 * 1000, expectedBuckets: 28 };
    default:
      throw new Error(`Unknown time range: ${String(range)}`);
  }
}

export function fillMissingBuckets(
  bucketCounts: Record<number, number>,
  config: TimeBucketConfig,
  rangeStart: Date,
  _rangeEnd: Date,
): TimeSeriesBucket[] {
  const result: TimeSeriesBucket[] = [];
  const startMs = rangeStart.getTime();

  for (let i = 0; i < config.expectedBuckets; i++) {
    const bucketTime = new Date(startMs + i * config.intervalMs);
    result.push({
      timestamp: bucketTime.toISOString(),
      count: bucketCounts[i] || 0,
    });
  }

  return result;
}
