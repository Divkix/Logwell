import type { TimeRange } from '$lib/components/time-range-picker.svelte';

export interface TimeBucketConfig {
  intervalMs: number;
  expectedBuckets: number;
}

export interface TimeSeriesBucket {
  timestamp: string;
  count: number;
}

/**
 * Get bucket configuration for a time range
 */
export function getTimeBucketConfig(range: TimeRange): TimeBucketConfig {
  switch (range) {
    case '15m':
      return { intervalMs: 60 * 1000, expectedBuckets: 15 };
    case '1h':
      return { intervalMs: 5 * 60 * 1000, expectedBuckets: 12 };
    case '24h':
      return { intervalMs: 60 * 60 * 1000, expectedBuckets: 24 };
    case '7d':
      return { intervalMs: 6 * 60 * 60 * 1000, expectedBuckets: 28 };
  }
}

/**
 * Group timestamps into bucket indices
 * Returns a map of bucketIndex -> count
 */
export function bucketTimestamps(
  timestamps: Date[],
  config: TimeBucketConfig,
  rangeStart: Date,
): Record<number, number> {
  const buckets: Record<number, number> = {};
  const startMs = rangeStart.getTime();

  for (const ts of timestamps) {
    const offsetMs = ts.getTime() - startMs;
    const bucketIndex = Math.floor(offsetMs / config.intervalMs);

    if (bucketIndex >= 0 && bucketIndex < config.expectedBuckets) {
      buckets[bucketIndex] = (buckets[bucketIndex] || 0) + 1;
    }
  }

  return buckets;
}

/**
 * Fill in missing buckets with zero counts
 * Returns array of TimeSeriesBucket sorted chronologically
 */
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
