import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { clampFutureTimestamp, MAX_FUTURE_SKEW_MS } from "./ingest-limits";

describe("clampFutureTimestamp", () => {
  const now = Date.UTC(2026, 0, 1);

  it.each([
    ["the past", now - 86_400_000, now - 86_400_000],
    ["exactly the skew ahead", now + MAX_FUTURE_SKEW_MS, now + MAX_FUTURE_SKEW_MS],
    ["one ms past the skew", now + MAX_FUTURE_SKEW_MS + 1, now],
    ["years ahead", now + 10 * 365 * 86_400_000, now],
  ])("%s", (_label, input, expected) => {
    expect(clampFutureTimestamp(new Date(input), now).getTime()).toBe(expected);
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
    expect(limits.clampFutureTimestamp(new Date(1001), 1000).getTime()).toBe(1000);
  });
});
