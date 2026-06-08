import { describe, expect, it } from "vite-plus/test";
import { generateApiKey, validateApiKeyFormat } from "./api-key";

describe("API Key Generation", () => {
  it("generateApiKey returns lw_ prefixed 32-char string", () => {
    const apiKey = generateApiKey();

    expect(apiKey).toBeDefined();
    expect(apiKey).toMatch(/^lw_[A-Za-z0-9_-]{32}$/);
    expect(apiKey.length).toBe(35); // 'lw_' (3 chars) + 32 chars
  });

  it("generateApiKey returns unique keys on multiple calls", () => {
    const key1 = generateApiKey();
    const key2 = generateApiKey();
    const key3 = generateApiKey();

    expect(key1).not.toBe(key2);
    expect(key2).not.toBe(key3);
    expect(key1).not.toBe(key3);
  });
});

describe("API Key Format Validation", () => {
  it("validateApiKeyFormat accepts valid API key format", () => {
    const validKeys = [
      "lw_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456",
      "lw_12345678901234567890123456789012",
      "lw_abcdefghijklmnopqrstuvwxyz123456",
      "lw_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
      "lw_aB1-_cD2eF3gH4iJ5kL6mN7oP8qR9sT0",
    ];

    for (const key of validKeys) {
      expect(validateApiKeyFormat(key)).toBe(true);
    }
  });

  it("validateApiKeyFormat rejects key without lw_ prefix", () => {
    const invalidKeys = [
      "aBcDeFgHiJkLmNoPqRsTuVwXyZ123456789",
      "api_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456",
      "l_aBcDeFgHiJkLmNoPqRsTuVwXyZ12345678",
      "lwaBcDeFgHiJkLmNoPqRsTuVwXyZ12345678",
    ];

    for (const key of invalidKeys) {
      expect(validateApiKeyFormat(key)).toBe(false);
    }
  });

  it("validateApiKeyFormat rejects key with wrong length", () => {
    const invalidKeys = [
      "lw_short",
      "lw_123",
      "lw_aBcDeFgHiJkLmNoPqRsTuVwXyZ12345", // 31 chars
      "lw_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567", // 33 chars
      "lw_",
      "lw_a",
    ];

    for (const key of invalidKeys) {
      expect(validateApiKeyFormat(key)).toBe(false);
    }
  });

  it("validateApiKeyFormat rejects key with invalid characters", () => {
    const invalidKeys = [
      "lw_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234$6", // $ not allowed
      "lw_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234@6", // @ not allowed
      "lw_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234!6", // ! not allowed
      "lw_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234 6", // space not allowed
      "lw_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234.6", // . not allowed
    ];

    for (const key of invalidKeys) {
      expect(validateApiKeyFormat(key)).toBe(false);
    }
  });

  it("validateApiKeyFormat rejects empty string", () => {
    expect(validateApiKeyFormat("")).toBe(false);
  });

  it("validateApiKeyFormat rejects null and undefined", () => {
    expect(validateApiKeyFormat(null as unknown as string)).toBe(false);
    expect(validateApiKeyFormat(undefined as unknown as string)).toBe(false);
  });
});
