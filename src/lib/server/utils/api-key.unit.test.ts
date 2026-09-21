import { beforeEach, describe, expect, it } from "vite-plus/test";
import type { DatabaseClient } from "$lib/server/db/db";
import {
  ApiKeyError,
  clearApiKeyCache,
  generateApiKey,
  hashApiKey,
  invalidateApiKeyCacheByHash,
  validateApiKey,
  validateApiKeyFormat,
} from "./api-key";

describe("API Key Generation", () => {
  it("generateApiKey returns lw_ prefixed 32-char unique strings", () => {
    const [key1, key2] = [generateApiKey(), generateApiKey()];

    for (const key of [key1, key2]) {
      expect(key).toMatch(/^lw_[A-Za-z0-9_-]{32}$/);
      expect(key).toHaveLength(35);
    }

    expect(key1).not.toBe(key2);
  });
});

describe("API Key Format Validation", () => {
  it.each([
    ["lw_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456", true, "mixed case"],
    ["lw_12345678901234567890123456789012", true, "digits"],
    ["lw_abcdefghijklmnopqrstuvwxyz123456", true, "lowercase"],
    ["lw_aB1-_cD2eF3gH4iJ5kL6mN7oP8qR9sT0", true, "dash+underscore"],
    ["aBcDeFgHiJkLmNoPqRsTuVwXyZ123456789", false, "no prefix"],
    ["api_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456", false, "wrong prefix"],
    ["lwaBcDeFgHiJkLmNoPqRsTuVwXyZ12345678", false, "missing underscore"],
    ["lw_short", false, "too short"],
    ["lw_aBcDeFgHiJkLmNoPqRsTuVwXyZ12345", false, "31 chars"],
    ["lw_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567", false, "33 chars"],
    ["lw_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234$6", false, "$ rejected"],
    ["lw_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234@6", false, "@ rejected"],
    ["lw_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234!6", false, "! rejected"],
    ["lw_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234 6", false, "space rejected"],
    ["", false, "empty"],
  ])("validateApiKeyFormat(%s) is %s (%s)", (key, valid) => {
    expect(validateApiKeyFormat(key)).toBe(valid);
  });

  it.each([[null], [undefined]])("validateApiKeyFormat rejects %s", (key) => {
    expect(validateApiKeyFormat(key as unknown as string)).toBe(false);
  });
});

describe("API key cache invalidation races", () => {
  const key = `lw_${"a".repeat(32)}`;

  function request(apiKey: string): Request {
    return new Request("http://localhost/v1/logs", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  }

  /** Minimal stand-in for the drizzle chain validateApiKey awaits. */
  function stubDb(read: () => Promise<Array<{ id: string }>>): DatabaseClient {
    return {
      select: () => ({ from: () => ({ where: () => read() }) }),
    } as unknown as DatabaseClient;
  }

  beforeEach(() => {
    clearApiKeyCache();
  });

  it("does not resurrect a key rotated while its lookup was in flight", async () => {
    const { promise, resolve } = Promise.withResolvers<Array<{ id: string }>>();

    const inFlight = validateApiKey(
      request(key),
      stubDb(() => promise),
    );

    invalidateApiKeyCacheByHash(hashApiKey(key));
    resolve([{ id: "project-1" }]);

    await expect(inFlight).resolves.toBe("project-1");

    const afterRotation = validateApiKey(
      request(key),
      stubDb(async () => []),
    );

    await expect(afterRotation).rejects.toBeInstanceOf(ApiKeyError);
  });

  it("caches successful lookups so a second request skips the database", async () => {
    let reads = 0;

    const db = stubDb(async () => {
      reads++;

      return [{ id: "project-2" }];
    });

    await expect(validateApiKey(request(key), db)).resolves.toBe("project-2");
    await expect(validateApiKey(request(key), db)).resolves.toBe("project-2");
    expect(reads).toBe(1);
  });
});
