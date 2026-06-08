import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

describe("Retention Configuration", () => {
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

  describe("LOG_RETENTION_DAYS", () => {
    it("should default to 30 when not set", async () => {
      vi.resetModules();
      delete process.env.LOG_RETENTION_DAYS;
      const { RETENTION_CONFIG } = await import("./performance");
      expect(RETENTION_CONFIG.LOG_RETENTION_DAYS).toBe(30);
    });

    it("should accept 0 (disabled)", async () => {
      vi.resetModules();
      process.env.LOG_RETENTION_DAYS = "0";
      const { RETENTION_CONFIG } = await import("./performance");
      expect(RETENTION_CONFIG.LOG_RETENTION_DAYS).toBe(0);
    });

    it("should clamp negative values to 0", async () => {
      vi.resetModules();
      process.env.LOG_RETENTION_DAYS = "-10";
      const { RETENTION_CONFIG } = await import("./performance");
      expect(RETENTION_CONFIG.LOG_RETENTION_DAYS).toBe(0);
    });

    it("should clamp values above 3650 to 3650", async () => {
      vi.resetModules();
      process.env.LOG_RETENTION_DAYS = "5000";
      const { RETENTION_CONFIG } = await import("./performance");
      expect(RETENTION_CONFIG.LOG_RETENTION_DAYS).toBe(3650);
    });

    it("should accept valid values within range", async () => {
      vi.resetModules();
      process.env.LOG_RETENTION_DAYS = "90";
      const { RETENTION_CONFIG } = await import("./performance");
      expect(RETENTION_CONFIG.LOG_RETENTION_DAYS).toBe(90);
    });

    it("should ignore invalid (non-numeric) values", async () => {
      vi.resetModules();
      process.env.LOG_RETENTION_DAYS = "invalid";
      const { RETENTION_CONFIG } = await import("./performance");
      expect(RETENTION_CONFIG.LOG_RETENTION_DAYS).toBe(30);
    });
  });

  describe("LOG_CLEANUP_INTERVAL_MS", () => {
    it("should default to 3600000 (1 hour) when not set", async () => {
      vi.resetModules();
      delete process.env.LOG_CLEANUP_INTERVAL_MS;
      const { RETENTION_CONFIG } = await import("./performance");
      expect(RETENTION_CONFIG.LOG_CLEANUP_INTERVAL_MS).toBe(3600000);
    });

    it("should clamp to minimum 60000 (1 minute)", async () => {
      vi.resetModules();
      process.env.LOG_CLEANUP_INTERVAL_MS = "30000";
      const { RETENTION_CONFIG } = await import("./performance");
      expect(RETENTION_CONFIG.LOG_CLEANUP_INTERVAL_MS).toBe(60000);
    });

    it("should clamp to maximum 86400000 (24 hours)", async () => {
      vi.resetModules();
      process.env.LOG_CLEANUP_INTERVAL_MS = "100000000";
      const { RETENTION_CONFIG } = await import("./performance");
      expect(RETENTION_CONFIG.LOG_CLEANUP_INTERVAL_MS).toBe(86400000);
    });

    it("should accept valid values within range", async () => {
      vi.resetModules();
      process.env.LOG_CLEANUP_INTERVAL_MS = "1800000";
      const { RETENTION_CONFIG } = await import("./performance");
      expect(RETENTION_CONFIG.LOG_CLEANUP_INTERVAL_MS).toBe(1800000);
    });

    it("should ignore invalid (non-numeric) values", async () => {
      vi.resetModules();
      process.env.LOG_CLEANUP_INTERVAL_MS = "invalid";
      const { RETENTION_CONFIG } = await import("./performance");
      expect(RETENTION_CONFIG.LOG_CLEANUP_INTERVAL_MS).toBe(3600000);
    });
  });
});
