import { describe, expect, test } from "vite-plus/test";
import { escapeCSVField } from "./csv-serializer";

describe("escapeCSVField", () => {
  test("returns empty string for null or undefined", () => {
    expect(escapeCSVField(null)).toBe("");
    expect(escapeCSVField(undefined)).toBe("");
  });

  test("converts numbers to strings", () => {
    expect(escapeCSVField(42)).toBe("42");
    expect(escapeCSVField(3.14)).toBe("3.14");
  });

  test("handles plain text without special characters", () => {
    expect(escapeCSVField("simple text")).toBe("simple text");
  });

  test("wraps fields with commas in quotes", () => {
    expect(escapeCSVField("hello, world")).toBe('"hello, world"');
  });

  test("escapes double quotes by doubling them", () => {
    expect(escapeCSVField('say "hello"')).toBe('"say ""hello"""');
  });

  test("wraps fields with newlines in quotes", () => {
    expect(escapeCSVField("line1\nline2")).toBe('"line1\nline2"');
  });

  test("handles combination of comma and quotes", () => {
    expect(escapeCSVField('error: "value", unexpected')).toBe('"error: ""value"", unexpected"');
  });

  test("handles empty strings", () => {
    expect(escapeCSVField("")).toBe("");
  });

  test("prefixes formula-starting characters with single quote (OWASP CSV injection)", () => {
    expect(escapeCSVField("=cmd|/C calc")).toBe("'=cmd|/C calc");
    expect(escapeCSVField("+cmd|/C calc")).toBe("'+cmd|/C calc");
    expect(escapeCSVField("-cmd|/C calc")).toBe("'-cmd|/C calc");
    expect(escapeCSVField("@SUM(A1:A10)")).toBe("'@SUM(A1:A10)");
  });

  test("does not prefix safe values", () => {
    expect(escapeCSVField("normal text")).toBe("normal text");
    expect(escapeCSVField("=acceptable when quoted")).toBe("'" + "=acceptable when quoted");
    expect(escapeCSVField("42")).toBe("42");
    expect(escapeCSVField("test-value")).toBe("test-value");
    expect(escapeCSVField("+1234567890")).toBe("'+1234567890");
  });

  test("handles formula chars with commas and quotes correctly", () => {
    expect(escapeCSVField("=formula, with comma")).toBe('"\'=formula, with comma"');
    expect(escapeCSVField('+formula "with" quotes')).toBe('"\'+formula ""with"" quotes"');
  });
});
