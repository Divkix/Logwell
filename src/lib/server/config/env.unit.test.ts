import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

describe("Environment Configuration", () => {
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

  describe("Required Environment Variables", () => {
    it("throws error when DATABASE_URL is not set", async () => {
      delete process.env.DATABASE_URL;
      process.env.BETTER_AUTH_SECRET = "a".repeat(32);

      await expect(import("./env")).rejects.toThrow("DATABASE_URL");
    });

    it("throws error when BETTER_AUTH_SECRET is not set in production", async () => {
      process.env.DATABASE_URL = "postgres://localhost/test";
      process.env.NODE_ENV = "production";
      delete process.env.BETTER_AUTH_SECRET;

      await expect(import("./env")).rejects.toThrow("BETTER_AUTH_SECRET");
    });

    it("throws error when BETTER_AUTH_SECRET is too short in production", async () => {
      process.env.DATABASE_URL = "postgres://localhost/test";
      process.env.NODE_ENV = "production";
      process.env.BETTER_AUTH_SECRET = "too-short";

      await expect(import("./env")).rejects.toThrow("32 characters");
    });

    it("allows missing BETTER_AUTH_SECRET in development", async () => {
      process.env.DATABASE_URL = "postgres://localhost/test";
      process.env.NODE_ENV = "development";
      delete process.env.BETTER_AUTH_SECRET;

      const { env } = await import("./env");
      expect(env.BETTER_AUTH_SECRET).toBeDefined();
    });
  });

  describe("Database Configuration", () => {
    it("exports DATABASE_URL from environment", async () => {
      process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/mydb";
      process.env.BETTER_AUTH_SECRET = "a".repeat(32);

      const { env } = await import("./env");
      expect(env.DATABASE_URL).toBe("postgres://user:pass@localhost:5432/mydb");
    });

    it("validates DATABASE_URL format starts with postgres", async () => {
      process.env.DATABASE_URL = "mysql://localhost/test";
      process.env.BETTER_AUTH_SECRET = "a".repeat(32);

      await expect(import("./env")).rejects.toThrow("PostgreSQL");
    });
  });

  describe("Authentication Configuration", () => {
    it("exports BETTER_AUTH_SECRET from environment", async () => {
      const secret = "a".repeat(32);
      process.env.DATABASE_URL = "postgres://localhost/test";
      process.env.BETTER_AUTH_SECRET = secret;

      const { env } = await import("./env");
      expect(env.BETTER_AUTH_SECRET).toBe(secret);
    });

    it("exports ADMIN_PASSWORD when set", async () => {
      process.env.DATABASE_URL = "postgres://localhost/test";
      process.env.BETTER_AUTH_SECRET = "a".repeat(32);
      process.env.ADMIN_PASSWORD = "securepassword123";

      const { env } = await import("./env");
      expect(env.ADMIN_PASSWORD).toBe("securepassword123");
    });

    it("returns undefined for ADMIN_PASSWORD when not set", async () => {
      process.env.DATABASE_URL = "postgres://localhost/test";
      process.env.BETTER_AUTH_SECRET = "a".repeat(32);
      delete process.env.ADMIN_PASSWORD;

      const { env } = await import("./env");
      expect(env.ADMIN_PASSWORD).toBeUndefined();
    });
  });

  describe("Optional Configuration", () => {
    it("exports ORIGIN when set", async () => {
      process.env.DATABASE_URL = "postgres://localhost/test";
      process.env.BETTER_AUTH_SECRET = "a".repeat(32);
      process.env.ORIGIN = "https://myapp.com";

      const { env } = await import("./env");
      expect(env.ORIGIN).toBe("https://myapp.com");
    });

    it("returns undefined for ORIGIN when not set", async () => {
      process.env.DATABASE_URL = "postgres://localhost/test";
      process.env.BETTER_AUTH_SECRET = "a".repeat(32);
      delete process.env.ORIGIN;

      const { env } = await import("./env");
      expect(env.ORIGIN).toBeUndefined();
    });

    it("exports NODE_ENV with default of development", async () => {
      process.env.DATABASE_URL = "postgres://localhost/test";
      process.env.BETTER_AUTH_SECRET = "a".repeat(32);
      delete process.env.NODE_ENV;

      const { env } = await import("./env");
      expect(env.NODE_ENV).toBe("development");
    });
  });

  describe("isProduction helper", () => {
    it("returns true when NODE_ENV is production", async () => {
      process.env.DATABASE_URL = "postgres://localhost/test";
      process.env.BETTER_AUTH_SECRET = "a".repeat(32);
      process.env.NODE_ENV = "production";

      const { isProduction } = await import("./env");
      expect(isProduction()).toBe(true);
    });

    it("returns false when NODE_ENV is development", async () => {
      process.env.DATABASE_URL = "postgres://localhost/test";
      process.env.BETTER_AUTH_SECRET = "a".repeat(32);
      process.env.NODE_ENV = "development";

      const { isProduction } = await import("./env");
      expect(isProduction()).toBe(false);
    });

    it("returns false when NODE_ENV is not set", async () => {
      process.env.DATABASE_URL = "postgres://localhost/test";
      process.env.BETTER_AUTH_SECRET = "a".repeat(32);
      delete process.env.NODE_ENV;

      const { isProduction } = await import("./env");
      expect(isProduction()).toBe(false);
    });
  });

  describe("isDevelopment helper", () => {
    it("returns true when NODE_ENV is development", async () => {
      process.env.DATABASE_URL = "postgres://localhost/test";
      process.env.BETTER_AUTH_SECRET = "a".repeat(32);
      process.env.NODE_ENV = "development";

      const { isDevelopment } = await import("./env");
      expect(isDevelopment()).toBe(true);
    });

    it("returns true when NODE_ENV is not set", async () => {
      process.env.DATABASE_URL = "postgres://localhost/test";
      process.env.BETTER_AUTH_SECRET = "a".repeat(32);
      delete process.env.NODE_ENV;

      const { isDevelopment } = await import("./env");
      expect(isDevelopment()).toBe(true);
    });

    it("returns false when NODE_ENV is production", async () => {
      process.env.DATABASE_URL = "postgres://localhost/test";
      process.env.BETTER_AUTH_SECRET = "a".repeat(32);
      process.env.NODE_ENV = "production";

      const { isDevelopment } = await import("./env");
      expect(isDevelopment()).toBe(false);
    });
  });
});
