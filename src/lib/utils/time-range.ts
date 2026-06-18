export type TimeRange = "15m" | "1h" | "24h" | "7d";

export const TIME_RANGES: readonly TimeRange[] = ["15m", "1h", "24h", "7d"] as const;

export const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  "15m": "Last 15 minutes",
  "1h": "Last hour",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
};

/**
 * Parse and validate a time-range query parameter.
 * Returns the narrowed TimeRange value if valid, or null for absent/unknown input.
 * This reproduces the `string | null → TimeRange | null` semantics needed by
 * page loaders that must handle raw query params before calling getTimeRangeStart.
 */
export function parseTimeRange(param: string | null): TimeRange | null {
  return param && (TIME_RANGES as readonly string[]).includes(param) ? (param as TimeRange) : null;
}
