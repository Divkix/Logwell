const HOUR_MS = 60 * 60 * 1000;

/**
 * Widest window an aggregate over `log` may cover. Matches the widest range the stats page
 * offers (7d) and stays well under the default 30-day retention: the window is the only bound
 * on the rows the aggregate reads, so one as long as retention bounds nothing.
 */
export const MAX_STATS_WINDOW_DAYS = 7;

/** Window used when `from` is omitted; the stats page's default range (24h). */
export const DEFAULT_STATS_WINDOW_HOURS = 24;

const MAX_STATS_WINDOW_MS = MAX_STATS_WINDOW_DAYS * 24 * HOUR_MS;

const DEFAULT_STATS_WINDOW_MS = DEFAULT_STATS_WINDOW_HOURS * HOUR_MS;

export interface StatsWindow {
  from: Date;
  to: Date;
}

export class InvalidTimeWindowError extends Error {
  constructor(
    readonly code: "invalid_date" | "invalid_range",
    message: string,
  ) {
    super(message);
    this.name = "InvalidTimeWindowError";
  }
}

function parseTimestamp(name: string, value: string): Date {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new InvalidTimeWindowError("invalid_date", `${name} must be an ISO 8601 timestamp`);
  }

  return date;
}

/**
 * Resolves `from`/`to` query parameters into a window of at most MAX_STATS_WINDOW_DAYS. This
 * caps time, not rows: the aggregate still reads every log of the project inside the window.
 * `to` defaults to `now` and `from` to `to` minus DEFAULT_STATS_WINDOW_HOURS.
 *
 * @throws InvalidTimeWindowError for an unparseable timestamp, `from` after `to`, or a window
 * wider than the maximum.
 */
export function resolveStatsWindow(
  fromParam: string | null,
  toParam: string | null,
  now: Date = new Date(),
): StatsWindow {
  const to = toParam ? parseTimestamp("to", toParam) : now;

  const from = fromParam
    ? parseTimestamp("from", fromParam)
    : new Date(to.getTime() - DEFAULT_STATS_WINDOW_MS);

  if (from > to) {
    throw new InvalidTimeWindowError("invalid_range", "from must not be after to");
  }

  if (to.getTime() - from.getTime() > MAX_STATS_WINDOW_MS) {
    throw new InvalidTimeWindowError(
      "invalid_range",
      `The time window cannot exceed ${MAX_STATS_WINDOW_DAYS} days`,
    );
  }

  return { from, to };
}
