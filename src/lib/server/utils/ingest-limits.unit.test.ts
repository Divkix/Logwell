import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  clampLogTimestamp,
  MAX_FUTURE_SKEW_MS,
  MAX_LOG_MESSAGE_LENGTH,
  MIN_LOG_TIMESTAMP_MS,
  truncateLogText,
} from "./ingest-limits";

describe("truncateLogText", () => {
  it("keeps text at the limit unchanged", () => {
    const text = "x".repeat(MAX_LOG_MESSAGE_LENGTH);

    expect(truncateLogText(text)).toBe(text);
  });

  it("cuts longer text to the limit and records the original length", () => {
    const length = MAX_LOG_MESSAGE_LENGTH * 5;
    const truncated = truncateLogText("x".repeat(length));

    expect(truncated).toHaveLength(MAX_LOG_MESSAGE_LENGTH);
    expect(truncated.endsWith(`… [truncated, ${length} characters]`)).toBe(true);
    expect(truncated.startsWith("xxxx")).toBe(true);
  });

  it("never splits a surrogate pair", () => {
    const truncated = truncateLogText("😀".repeat(MAX_LOG_MESSAGE_LENGTH));
    const kept = truncated.slice(0, truncated.indexOf("…"));

    expect(kept).toBe("😀".repeat(kept.length / 2));
  });
});

describe("clampLogTimestamp", () => {
  const now = Date.UTC(2026, 0, 1);

  it.each([
    ["the past", now - 86_400_000, now - 86_400_000],
    ["exactly the skew ahead", now + MAX_FUTURE_SKEW_MS, now + MAX_FUTURE_SKEW_MS],
    ["one ms past the skew", now + MAX_FUTURE_SKEW_MS + 1, now],
    ["years ahead", now + 10 * 365 * 86_400_000, now],
    ["exactly 0001-01-01", MIN_LOG_TIMESTAMP_MS, MIN_LOG_TIMESTAMP_MS],
    ["one ms before 0001-01-01", MIN_LOG_TIMESTAMP_MS - 1, now],
    ["year 0 (1 BC)", Date.parse("0000-06-01T00:00:00Z"), now],
    ["a BC year", Date.parse("-005000-01-01T00:00:00Z"), now],
  ])("%s", (_label, input, expected) => {
    expect(clampLogTimestamp(new Date(input), now).getTime()).toBe(expected);
  });

  it("puts the lower bound at 0001-01-01T00:00:00Z", () => {
    expect(new Date(MIN_LOG_TIMESTAMP_MS).toISOString()).toBe("0001-01-01T00:00:00.000Z");
  });
});

describe("MAX_FUTURE_SKEW_MS", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("defaults to five minutes", () => {
    expect(MAX_FUTURE_SKEW_MS).toBe(300_000);
  });

  it("reads INGEST_MAX_FUTURE_SKEW_MS", async () => {
    vi.stubEnv("INGEST_MAX_FUTURE_SKEW_MS", "0");
    vi.resetModules();

    const limits = await import("./ingest-limits");

    expect(limits.MAX_FUTURE_SKEW_MS).toBe(0);
    expect(limits.clampLogTimestamp(new Date(1001), 1000).getTime()).toBe(1000);
  });
});
