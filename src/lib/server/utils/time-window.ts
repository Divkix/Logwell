/** Widest window an aggregate over `log` may cover; also the default when `from` is omitted. */
export const MAX_STATS_WINDOW_DAYS = 90;

const MAX_STATS_WINDOW_MS = MAX_STATS_WINDOW_DAYS * 24 * 60 * 60 * 1000;

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
 * Resolves `from`/`to` query parameters into a window of at most MAX_STATS_WINDOW_DAYS, so an
 * aggregate never scans a project's whole retention. `to` defaults to `now` and `from` to
 * `to` minus the maximum window.
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
    : new Date(to.getTime() - MAX_STATS_WINDOW_MS);

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
