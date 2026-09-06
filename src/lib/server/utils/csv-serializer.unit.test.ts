import { describe, expect, test } from "vite-plus/test";
import { escapeCSVField } from "./csv-serializer";

describe("escapeCSVField", () => {
  test.each([
    [null, "", "null"],
    [undefined, "", "undefined"],
    ["", "", "empty string"],
    [42, "42", "number"],
    [3.14, "3.14", "float"],
    ["simple text", "simple text", "plain text"],
    ["42", "42", "numeric string"],
    ["test-value", "test-value", "dash"],
    ["normal text", "normal text", "safe value"],
    ["hello, world", '"hello, world"', "comma"],
    ['say "hello"', '"say ""hello"""', "quotes doubled"],
    ["line1\nline2", '"line1\nline2"', "newline"],
    ['error: "value", unexpected', '"error: ""value"", unexpected"', "comma+quotes"],
  ] as [string | number | null | undefined, string, string][])(
    "escapeCSVField(%s) returns %s (%s)",
    (input, expected) => {
      expect(escapeCSVField(input)).toBe(expected);
    },
  );

  // OWASP CSV formula-injection guard: leading = + - @ get a ' prefix
  test.each([
    ["=cmd|/C calc", "'=cmd|/C calc"],
    ["+cmd|/C calc", "'+cmd|/C calc"],
    ["-cmd|/C calc", "'-cmd|/C calc"],
    ["@SUM(A1:A10)", "'@SUM(A1:A10)"],
    ["+1234567890", "'+1234567890"],
    ["=formula, with comma", '"\'=formula, with comma"'],
    ['+formula "with" quotes', '"\'+formula ""with"" quotes"'],
  ])("prefixes formula %s as %s", (input, expected) => {
    expect(escapeCSVField(input)).toBe(expected);
  });
});
