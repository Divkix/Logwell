import { describe, expect, test } from "vite-plus/test";
import { escapeCSVField } from "./csv-serializer";

describe("escapeCSVField", () => {
  // Last column labels the input class. The `formula` rows double as the OWASP CSV
  // formula-injection guard: a leading = + - @ must get a ' prefix.
  const cases: Array<[string | number | null | undefined, string, string]> = [
    [null, "", "null"],
    [undefined, "", "undefined"],
    ["", "", "empty string"],
    [42, "42", "number"],
    [3.14, "3.14", "float"],
    ["simple text", "simple text", "plain text"],
    ["42", "42", "numeric string"],
    ["test-value", "test-value", "dash"],
    ["hello, world", '"hello, world"', "comma"],
    ['say "hello"', '"say ""hello"""', "quotes doubled"],
    ["line1\nline2", '"line1\nline2"', "newline"],
    ["=cmd|/C calc", "'=cmd|/C calc", "formula ="],
    ["+cmd|/C calc", "'+cmd|/C calc", "formula +"],
    ["-cmd|/C calc", "'-cmd|/C calc", "formula -"],
    ["@SUM(A1:A10)", "'@SUM(A1:A10)", "formula @"],
    ["=formula, with comma", '"\'=formula, with comma"', "formula & comma"],
    ['+formula "with" quotes', '"\'+formula ""with"" quotes"', "formula & quotes"],
  ];

  test.each(cases)("escapeCSVField(%s) returns %s (%s)", (input, expected) => {
    expect(escapeCSVField(input)).toBe(expected);
  });
});
