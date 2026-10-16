import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_STATS_WINDOW_HOURS,
  InvalidTimeWindowError,
  MAX_STATS_WINDOW_DAYS,
  resolveStatsWindow,
} from "./time-window";

const HOUR_MS = 60 * 60 * 1000;

const DAY_MS = 24 * HOUR_MS;

const now = new Date("2026-06-01T12:00:00.000Z");

function windowErrorCode(resolve: () => void): InvalidTimeWindowError["code"] | undefined {
  try {
    resolve();
  } catch (error) {
    if (error instanceof InvalidTimeWindowError) return error.code;

    throw error;
  }

  return undefined;
}

describe("resolveStatsWindow", () => {
  it("defaults to the last 24 hours ending now", () => {
    const { from, to } = resolveStatsWindow(null, null, now);

    expect(to).toEqual(now);
    expect(to.getTime() - from.getTime()).toBe(DEFAULT_STATS_WINDOW_HOURS * HOUR_MS);
  });

  it("anchors a missing from to an explicit to", () => {
    const { from, to } = resolveStatsWindow(null, "2026-01-01T00:00:00.000Z", now);

    expect(to.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(to.getTime() - from.getTime()).toBe(DEFAULT_STATS_WINDOW_HOURS * HOUR_MS);
  });

  it("accepts a window of exactly the maximum", () => {
    const from = new Date(now.getTime() - MAX_STATS_WINDOW_DAYS * DAY_MS).toISOString();

    expect(resolveStatsWindow(from, null, now).from.toISOString()).toBe(from);
  });

  it("rejects a window wider than the maximum", () => {
    const from = new Date(now.getTime() - MAX_STATS_WINDOW_DAYS * DAY_MS - 1).toISOString();

    expect(windowErrorCode(() => resolveStatsWindow(from, null, now))).toBe("invalid_range");
  });

  it("rejects from after to", () => {
    expect(
      windowErrorCode(() =>
        resolveStatsWindow("2026-05-02T00:00:00Z", "2026-05-01T00:00:00Z", now),
      ),
    ).toBe("invalid_range");
  });

  it.each([
    ["from", "yesterday", null],
    ["to", null, "not-a-date"],
  ])("rejects an unparseable %s", (_name, from, to) => {
    expect(windowErrorCode(() => resolveStatsWindow(from, to, now))).toBe("invalid_date");
  });
});
