import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

describe("Performance Configuration", () => {
  // Store original env
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset module cache to allow re-importing with new env
    vi.resetModules();
  });

  afterEach(() => {
    // Mutate process.env in place: reassigning it to `originalEnv` would make later test writes
    // mutate the snapshot itself, leaking env (e.g. an SSE_* clamp value) into every later test.
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    vi.resetModules();
  });

  describe("SSE Batching Configuration", () => {
    it.each([
      ["BATCH_WINDOW_MS", 1500],
      ["MAX_BATCH_SIZE", 50],
    ])("exports %s with default value of %d", async (key, expected) => {
      vi.resetModules();
      const { SSE_CONFIG } = await import("./performance");
      expect(SSE_CONFIG[key as keyof typeof SSE_CONFIG]).toBe(expected);
    });

    it.each([
      ["SSE_BATCH_WINDOW_MS", "BATCH_WINDOW_MS", "2000", 2000],
      ["SSE_MAX_BATCH_SIZE", "MAX_BATCH_SIZE", "100", 100],
    ])("respects %s environment variable", async (envKey, configKey, envValue, expected) => {
      vi.resetModules();
      process.env[envKey] = envValue;
      const { SSE_CONFIG } = await import("./performance");
      expect(SSE_CONFIG[configKey as keyof typeof SSE_CONFIG]).toBe(expected);
    });

    it("respects SSE_HEARTBEAT_INTERVAL_MS when the idle timeout leaves room", async () => {
      vi.resetModules();
      process.env.IDLE_TIMEOUT = "120";
      process.env.SSE_HEARTBEAT_INTERVAL_MS = "60000";
      const { SSE_CONFIG } = await import("./performance");
      expect(SSE_CONFIG.HEARTBEAT_INTERVAL_MS).toBe(60000);
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

    it.each([
      ["SSE_BATCH_WINDOW_MS", "BATCH_WINDOW_MS", "invalid", 1500],
      ["SSE_BATCH_WINDOW_MS", "BATCH_WINDOW_MS", "30s", 1500],
      ["SSE_MAX_BATCH_SIZE", "MAX_BATCH_SIZE", "100 logs", 50],
    ])(
      "ignores %s=%s instead of parsing a numeric prefix",
      async (envKey, configKey, value, expected) => {
        process.env[envKey] = value;
        const { SSE_CONFIG } = await import("./performance");
        expect(SSE_CONFIG[configKey as keyof typeof SSE_CONFIG]).toBe(expected);
      },
    );
  });

  describe("SSE Heartbeat vs Server Idle Timeout", () => {
    // IDLE_TIMEOUT is what build/index.js hands to Bun.serve; the config module reads it once at
    // import time, so every case re-imports a fresh module with its own env.
    it.each([
      [undefined, 5000, 10_000, "unset → adapter default 10s"],
      ["10", 5000, 10_000, "explicit 10s"],
      ["20", 10000, 20_000, "half of 20s"],
      ["120", 30000, 120_000, "shipped image: documented default survives"],
      ["5", 2500, 5000, "idle timeout below the heartbeat floor lowers the floor too"],
      ["0", 1000, 0, "idle timeout 0 (disabled) never becomes a 0ms hot loop"],
      ["600", 30000, 255_000, "above Bun's 255s cap: heartbeat sized against the real window"],
    ] as [string | undefined, number, number, string][])(
      "IDLE_TIMEOUT=%s → heartbeat %dms (%s)",
      async (idleTimeout, expected, idleMs) => {
        vi.resetModules();
        if (idleTimeout === undefined) delete process.env.IDLE_TIMEOUT;
        else process.env.IDLE_TIMEOUT = idleTimeout;
        const { SSE_CONFIG } = await import("./performance");
        expect(SSE_CONFIG.HEARTBEAT_INTERVAL_MS).toBe(expected);
        if (idleMs > 0) {
          expect(SSE_CONFIG.HEARTBEAT_INTERVAL_MS).toBeLessThan(idleMs);
        }
      },
    );

    it("clamps an oversized SSE_HEARTBEAT_INTERVAL_MS below the idle timeout", async () => {
      vi.resetModules();
      delete process.env.IDLE_TIMEOUT;
      process.env.SSE_HEARTBEAT_INTERVAL_MS = "60000";
      const { SSE_CONFIG } = await import("./performance");
      expect(SSE_CONFIG.HEARTBEAT_INTERVAL_MS).toBe(5000);
      expect(SSE_CONFIG.HEARTBEAT_INTERVAL_MS).toBeLessThan(10_000);
    });
  });

  describe("Log Stream Configuration", () => {
    it.each([
      [undefined, 1000, "default 1000"],
      ["5000", 5000, "env override"],
      ["20000", 10000, "clamped to upper limit"],
      ["5k", 1000, "unit suffix must not truncate to 5"],
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

  describe("Retention Configuration", () => {
    it.each([
      [undefined, 30, "default 30"],
      ["0", 0, "0 is documented as disabled, so it stays 0"],
      ["90", 90, "in range"],
      ["3650", 3650, "documented max"],
      ["5000", 3650, "above max clamps down to the max, never to 0"],
      ["-10", 30, "negative falls back to the default instead of 0 = never delete"],
      ["6 months", 30, "human-readable value must not truncate to 6 days"],
      ["1e999", 30, "overflow must not truncate to 1 day"],
      ["30.5", 30, "fractional rejected"],
    ] as [string | undefined, number, string][])(
      "LOG_RETENTION_DAYS=%s → %s (%s)",
      async (value, expected) => {
        vi.resetModules();
        if (value === undefined) delete process.env.LOG_RETENTION_DAYS;
        else process.env.LOG_RETENTION_DAYS = value as string;
        const { RETENTION_CONFIG } = await import("./performance");
        expect(RETENTION_CONFIG.LOG_RETENTION_DAYS).toBe(expected);
      },
    );

    it.each([
      [undefined, 3600000, "default 1 hour"],
      ["1800000", 1800000, "in range"],
      ["30000", 60000, "below min clamps to 1 minute"],
      ["100000000", 86400000, "above max clamps to 24 hours"],
      ["30m", 3600000, "unit suffix must not truncate to 30ms (cleanup every minute)"],
    ] as [string | undefined, number, string][])(
      "LOG_CLEANUP_INTERVAL_MS=%s → %s (%s)",
      async (value, expected) => {
        vi.resetModules();
        if (value === undefined) delete process.env.LOG_CLEANUP_INTERVAL_MS;
        else process.env.LOG_CLEANUP_INTERVAL_MS = value as string;
        const { RETENTION_CONFIG } = await import("./performance");
        expect(RETENTION_CONFIG.LOG_CLEANUP_INTERVAL_MS).toBe(expected);
      },
    );
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
      ["1h", 30, "unit suffix must not truncate to 1"],
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
