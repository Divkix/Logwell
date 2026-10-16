import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

describe("Environment Configuration", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    // A fresh copy each time: restoring the snapshot object itself would let the next
    // test's overrides write into it and leak into every test after.
    process.env = { ...originalEnv };
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

  // SAFETY: each row is [env overrides record, expected error fragment, label] — the
  // literals above the callback only take those three shapes.
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
    [
      { NODE_ENV: "production", BETTER_AUTH_SECRET: "your-32-character-secret-key-here" },
      "placeholder",
      ".env.example placeholder secret in production",
    ],
    [
      { NODE_ENV: undefined, BETTER_AUTH_SECRET: "default-secret-for-development-only" },
      "placeholder",
      "dev fallback secret with NODE_ENV unset",
    ],
    [{ DATABASE_URL: "mysql://localhost/test" }, "PostgreSQL", "non-postgres URL"],
    [{ ORIGIN: "logs.example.com" }, "absolute URL", "ORIGIN without a scheme"],
  ] as [Record<string, string | undefined>, string, string][])(
    "rejects %s (%s)",
    async (overrides, message) => {
      await expect(loadEnv(overrides)).rejects.toThrow(message);
    },
  );

  it("enforces the secret rules for an unrecognised NODE_ENV", async () => {
    await expect(loadEnv({ NODE_ENV: "staging", BETTER_AUTH_SECRET: "too-short" })).rejects.toThrow(
      "32 characters",
    );
  });

  it("treats the empty .env.example secret as unset", async () => {
    await expect(loadEnv({ NODE_ENV: "production", BETTER_AUTH_SECRET: "" })).rejects.toThrow(
      "BETTER_AUTH_SECRET is required",
    );

    vi.resetModules();
    const { env } = await loadEnv({ NODE_ENV: "development", BETTER_AUTH_SECRET: "" });
    expect(env.BETTER_AUTH_SECRET).toBe("default-secret-for-development-only");
  });

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
    // SAFETY: DATABASE_URL, BETTER_AUTH_SECRET, ADMIN_PASSWORD and ORIGIN are all exports
    // of config/env, so both key and value exist on env as asserted below.
    expect(env[key as keyof typeof env]).toBe(value);
  });

  it("returns undefined for unset optional variables", async () => {
    const { env } = await loadEnv({ ADMIN_PASSWORD: undefined, ORIGIN: undefined });
    expect(env.ADMIN_PASSWORD).toBeUndefined();
    expect(env.ORIGIN).toBeUndefined();
  });

  it("defaults NODE_ENV to production when unset", async () => {
    const { env, isProduction, isDevelopment } = await loadEnv({ NODE_ENV: undefined });
    expect(env.NODE_ENV).toBe("production");
    expect(isProduction()).toBe(true);
    expect(isDevelopment()).toBe(false);
  });

  it("defaults the Postgres pool timeouts to 30s statement / 60s idle-in-transaction", async () => {
    const { env } = await loadEnv({
      DB_STATEMENT_TIMEOUT_MS: undefined,
      DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: "",
    });

    expect(env.DB_STATEMENT_TIMEOUT_MS).toBe(30_000);
    expect(env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS).toBe(60_000);
  });

  it("accepts explicit pool timeouts, including 0 to disable", async () => {
    const { env } = await loadEnv({
      DB_STATEMENT_TIMEOUT_MS: " 5000 ",
      DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: "0",
    });

    expect(env.DB_STATEMENT_TIMEOUT_MS).toBe(5000);
    expect(env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS).toBe(0);
  });

  it.each([
    ["DB_STATEMENT_TIMEOUT_MS", "30s", "whole number"],
    ["DB_STATEMENT_TIMEOUT_MS", "-1", "whole number"],
    ["DB_IDLE_IN_TRANSACTION_TIMEOUT_MS", "1.5", "whole number"],
    ["DB_IDLE_IN_TRANSACTION_TIMEOUT_MS", "3600001", "at most 3600000"],
  ])("rejects %s=%s at startup", async (key, value, message) => {
    await expect(loadEnv({ [key]: value })).rejects.toThrow(`${key} must be`);
    await expect(loadEnv({ [key]: value })).rejects.toThrow(message);
  });

  it.each([
    ["production", true, false],
    ["development", false, true],
    ["test", false, true],
    ["staging", true, false],
    ["Production", true, false],
  ])("NODE_ENV=%s → isProduction=%s isDevelopment=%s", async (nodeEnv, prod, dev) => {
    const { isProduction, isDevelopment } = await loadEnv({ NODE_ENV: nodeEnv });

    expect(isProduction()).toBe(prod);
    expect(isDevelopment()).toBe(dev);
  });
});
