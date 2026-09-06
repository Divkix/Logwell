import { describe, expect, it } from "vite-plus/test";
import { generateApiKey, validateApiKeyFormat } from "./api-key";

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
