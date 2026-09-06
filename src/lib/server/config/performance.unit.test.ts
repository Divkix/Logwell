import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

describe("Performance Configuration", () => {
  // Store original env
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset module cache to allow re-importing with new env
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
    vi.resetModules();
  });

  describe("SSE Batching Configuration", () => {
    it.each([
      ["BATCH_WINDOW_MS", 1500],
      ["MAX_BATCH_SIZE", 50],
      ["HEARTBEAT_INTERVAL_MS", 30000],
    ])("exports %s with default value of %d", async (key, expected) => {
      vi.resetModules();
      const { SSE_CONFIG } = await import("./performance");
      expect(SSE_CONFIG[key as keyof typeof SSE_CONFIG]).toBe(expected);
    });

    it.each([
      ["SSE_BATCH_WINDOW_MS", "BATCH_WINDOW_MS", "2000", 2000],
      ["SSE_MAX_BATCH_SIZE", "MAX_BATCH_SIZE", "100", 100],
      ["SSE_HEARTBEAT_INTERVAL_MS", "HEARTBEAT_INTERVAL_MS", "60000", 60000],
    ])("respects %s environment variable", async (envKey, configKey, envValue, expected) => {
      vi.resetModules();
      process.env[envKey] = envValue;
      const { SSE_CONFIG } = await import("./performance");
      expect(SSE_CONFIG[configKey as keyof typeof SSE_CONFIG]).toBe(expected);
    });

    it.each([
      ["SSE_BATCH_WINDOW_MS", "BATCH_WINDOW_MS", "50", 100],
      ["SSE_MAX_BATCH_SIZE", "MAX_BATCH_SIZE", "0", 1],
      ["SSE_HEARTBEAT_INTERVAL_MS", "HEARTBEAT_INTERVAL_MS", "1000", 5000],
    ])("clamps %s to minimum", async (envKey, configKey, envValue, expected) => {
      vi.resetModules();
      process.env[envKey] = envValue;
      const { SSE_CONFIG } = await import("./performance");
      expect(SSE_CONFIG[configKey as keyof typeof SSE_CONFIG]).toBe(expected);
    });

    it("ignores invalid (non-numeric) environment values", async () => {
      process.env.SSE_BATCH_WINDOW_MS = "invalid";
      const { SSE_CONFIG } = await import("./performance");
      expect(SSE_CONFIG.BATCH_WINDOW_MS).toBe(1500);
    });
  });

  describe("Log Stream Configuration", () => {
    it.each([
      [undefined, 1000, "default 1000"],
      ["5000", 5000, "env override"],
      ["20000", 10000, "clamped to upper limit"],
    ] as [string | undefined, number, string][])(
      "LOG_STREAM_MAX_LOGS=%s → %s (%s)",
      async (value, expected) => {
        vi.resetModules();
        if (value === undefined) delete process.env.LOG_STREAM_MAX_LOGS;
        else process.env.LOG_STREAM_MAX_LOGS = value as string;
        const { LOG_STREAM_CONFIG } = await import("./performance");
        expect(LOG_STREAM_CONFIG.DEFAULT_MAX_LOGS).toBe(expected);
      },
    );

    it("exports MAX_LOGS_UPPER_LIMIT with value of 10000", async () => {
      const { LOG_STREAM_CONFIG } = await import("./performance");
      expect(LOG_STREAM_CONFIG.MAX_LOGS_UPPER_LIMIT).toBe(10000);
    });
  });

  describe("API Rate Limiting Configuration", () => {
    it.each([
      ["BATCH_INSERT_LIMIT", 100],
      ["DEFAULT_PAGE_SIZE", 100],
      ["MAX_PAGE_SIZE", 500],
    ])("exports %s with value %d", async (key, expected) => {
      const { API_CONFIG } = await import("./performance");
      expect(API_CONFIG[key as keyof typeof API_CONFIG]).toBe(expected);
    });
  });

  describe("Incident Configuration", () => {
    it.each([
      [undefined, 30, "default 30"],
      ["45", 45, "env override"],
      ["0", 1, "clamped to minimum"],
    ] as [string | undefined, number, string][])(
      "INCIDENT_AUTO_RESOLVE_MINUTES=%s → %s (%s)",
      async (value, expected) => {
        vi.resetModules();
        if (value === undefined) delete process.env.INCIDENT_AUTO_RESOLVE_MINUTES;
        else process.env.INCIDENT_AUTO_RESOLVE_MINUTES = value as string;
        const { INCIDENT_CONFIG } = await import("./performance");
        expect(INCIDENT_CONFIG.AUTO_RESOLVE_MINUTES).toBe(expected);
      },
    );
  });
});
