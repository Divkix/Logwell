export type TimeRange = "15m" | "1h" | "24h" | "7d";

export const TIME_RANGES: readonly TimeRange[] = ["15m", "1h", "24h", "7d"] as const;

export const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  "15m": "Last 15 minutes",
  "1h": "Last hour",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
};
