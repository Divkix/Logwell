import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { DatabaseClient } from "./db/db";

describe("createAuth production safeguards", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  async function authOptionsFor(nodeEnv: string) {
    vi.resetModules();
    process.env.NODE_ENV = nodeEnv;
    process.env.DATABASE_URL = "postgres://localhost/test";
    process.env.BETTER_AUTH_SECRET = "s".repeat(40);

    const { createAuth } = await import("./auth");

    // SAFETY: createAuth only hands the client to drizzleAdapter, which defers every query
    // until a request runs; these tests read the resolved options and never query.
    return createAuth({} as DatabaseClient).options;
  }

  it.each([
    ["production", true],
    ["staging", true],
    ["development", false],
    ["test", false],
  ])("NODE_ENV=%s → rate limiter and Secure cookies %s", async (nodeEnv, expected) => {
    const options = await authOptionsFor(nodeEnv);

    expect(options.rateLimit?.enabled).toBe(expected);
    expect(options.advanced?.useSecureCookies).toBe(expected);
  });
});
