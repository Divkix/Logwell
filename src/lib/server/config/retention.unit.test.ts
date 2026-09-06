import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

describe("Retention Configuration", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetModules();
  });

  async function loadRetention(overrides: Record<string, string | undefined>) {
    vi.resetModules();
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return import("./performance");
  }

  it.each([
    [undefined, 30, "default 30"],
    ["0", 0, "0 disables"],
    ["-10", 0, "negative clamps to 0"],
    ["5000", 3650, "above max clamps to 3650"],
    ["90", 90, "in range"],
    ["invalid", 30, "non-numeric ignored"],
  ] as [string | undefined, number, string][])(
    "LOG_RETENTION_DAYS=%s → %s (%s)",
    async (value, expected) => {
      const { RETENTION_CONFIG } = await loadRetention({
        LOG_RETENTION_DAYS: value as string | undefined,
      });
      expect(RETENTION_CONFIG.LOG_RETENTION_DAYS).toBe(expected);
    },
  );

  it.each([
    [undefined, 3600000, "default 1 hour"],
    ["30000", 60000, "below min clamps to 1 minute"],
    ["100000000", 86400000, "above max clamps to 24 hours"],
    ["1800000", 1800000, "in range"],
    ["invalid", 3600000, "non-numeric ignored"],
  ] as [string | undefined, number, string][])(
    "LOG_CLEANUP_INTERVAL_MS=%s → %s (%s)",
    async (value, expected) => {
      const { RETENTION_CONFIG } = await loadRetention({
        LOG_CLEANUP_INTERVAL_MS: value as string | undefined,
      });
      expect(RETENTION_CONFIG.LOG_CLEANUP_INTERVAL_MS).toBe(expected);
    },
  );
});
