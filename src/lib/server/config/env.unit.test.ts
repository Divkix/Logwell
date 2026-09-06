import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

describe("Environment Configuration", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetModules();
  });

  async function loadEnv(overrides: Record<string, string | undefined>) {
    process.env.DATABASE_URL = "postgres://localhost/test";
    process.env.BETTER_AUTH_SECRET = "a".repeat(32);
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return import("./env");
  }

  it.each([
    [
      { DATABASE_URL: undefined, BETTER_AUTH_SECRET: "a".repeat(32) },
      "DATABASE_URL",
      "missing DATABASE_URL",
    ],
    [
      { NODE_ENV: "production", BETTER_AUTH_SECRET: undefined },
      "BETTER_AUTH_SECRET",
      "missing secret in production",
    ],
    [
      { NODE_ENV: "production", BETTER_AUTH_SECRET: "too-short" },
      "32 characters",
      "short secret in production",
    ],
    [{ DATABASE_URL: "mysql://localhost/test" }, "PostgreSQL", "non-postgres URL"],
  ] as [Record<string, string | undefined>, string, string][])(
    "rejects %s (%s)",
    async (overrides, message) => {
      await expect(loadEnv(overrides)).rejects.toThrow(message);
    },
  );

  it("allows missing BETTER_AUTH_SECRET in development", async () => {
    const { env } = await loadEnv({ NODE_ENV: "development", BETTER_AUTH_SECRET: undefined });
    expect(env.BETTER_AUTH_SECRET).toBeDefined();
  });

  it.each([
    ["DATABASE_URL", "postgres://user:pass@localhost:5432/mydb", "database URL"],
    ["BETTER_AUTH_SECRET", "a".repeat(32), "auth secret"],
    ["ADMIN_PASSWORD", "securepassword123", "admin password"],
    ["ORIGIN", "https://myapp.com", "origin"],
  ])("exports %s from environment (%s)", async (key, value) => {
    const { env } = await loadEnv({ [key]: value });
    expect(env[key as keyof typeof env]).toBe(value);
  });

  it.each([["ADMIN_PASSWORD"], ["ORIGIN"]])("returns undefined for unset %s", async (key) => {
    const { env } = await loadEnv({ [key]: undefined });
    expect(env[key as keyof typeof env]).toBeUndefined();
  });

  it("defaults NODE_ENV to production when unset", async () => {
    const { env } = await loadEnv({ NODE_ENV: undefined });
    expect(env.NODE_ENV).toBe("production");
  });

  it.each([
    ["production", true, false],
    ["development", false, true],
    [undefined, true, false],
  ])("NODE_ENV=%s → isProduction=%s isDevelopment=%s", async (nodeEnv, prod, dev) => {
    const { isProduction, isDevelopment } = await loadEnv({
      NODE_ENV: nodeEnv as string | undefined,
    });
    expect(isProduction()).toBe(prod);
    expect(isDevelopment()).toBe(dev);
  });
});
